import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { prepareFrameworkBuild } from "@evjs/ev/_internal/build";
import { build, moduleReferencesVersion } from "@utoo/pack";
import { createUtoopackConfig } from "../../esm/adapter/config/create-config.js";
import { assertUtoopackModuleReferenceSupport } from "../../esm/adapter/config/module-references.js";

const [cwd] = process.argv.slice(2);
assert(cwd, "Native reference harness requires a project directory.");
// This test must fail on an older package or a mismatched native addon.
assert.equal(
  moduleReferencesVersion,
  1,
  "Requires @utoo/pack 1.6.0 native references",
);

const implementationMarker = "ORIGINAL_GREETING_IMPLEMENTATION";
const sideEffectMarker = "ORIGINAL_GREETING_SIDE_EFFECT";
const sourceFiles = {
  "package.json": '{ "private": true }',
  "index.html": '<div id="app"></div>',
  "src/pages/page.tsx": "export default function Page() { return null; }",
  "src/greeting.js": `
    globalThis.${sideEffectMarker} = 1;
    export class Greeting {
      greet() { return "${implementationMarker}"; }
    }
    export default Greeting;
  `,
  "src/ordinary.js": `
    globalThis.ordinaryEvaluations = (globalThis.ordinaryEvaluations || 0) + 1;
    export function greet() { return "ordinary greeting"; }
  `,
  "src/runtime.js": `
    export let creations = 0;
    export function createReference(data) {
      creations++;
      return class GreetingReference {
        greet(name) { return data.prefix + " " + name; }
      };
    }
  `,
  "src/entry.js": `
    import DefaultGreeting, { Greeting } from "./greeting.js";
    import { creations } from "./runtime.js";
    import { greet } from "./ordinary.js";
    globalThis.GreetingFixture = {
      sameIdentity: DefaultGreeting === Greeting,
      greeting: new Greeting().greet("Ada"),
      creations,
      ordinaryGreeting: greet(),
    };
  `,
};
for (const [filename, source] of Object.entries(sourceFiles)) {
  const target = path.join(cwd, filename);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, source);
}

const prepared = await prepareFrameworkBuild(
  {
    routing: { mode: "spa" },
    plugins: [
      {
        id: "greeting-reference",
        emitIR({ emit, slot }) {
          emit.moduleReference({
            id: "greeting",
            resource: "./src/greeting.js",
            references: [
              {
                id: "greeting",
                factory: {
                  module: "./src/runtime.js",
                  export: "createReference",
                },
                data: { prefix: "Hello" },
              },
            ],
            exports: [
              { name: "Greeting", reference: "greeting" },
              { name: "default", reference: "greeting" },
            ],
          });
          // Keep the real application emitter while avoiding a React renderer
          // dependency in this focused compiler-boundary fixture.
          slot("client.entry").add({
            id: "entry-slot",
            module: "./src/entry.js",
            position: "before-main",
            mode: "replace",
          });
        },
      },
    ],
  },
  { cwd, mode: "production" },
);

try {
  const { plan } = JSON.parse(
    await fs.readFile(path.join(cwd, ".ev/framework/build-plan.json"), "utf8"),
  );
  const config = await createUtoopackConfig(prepared.config, plan, cwd, [
    {
      configureBundler(config) {
        config.sourceMaps = true;
        config.persistentCaching = false;
        config.optimization.minify = false;
      },
    },
  ]);
  assertUtoopackModuleReferenceSupport({ moduleReferencesVersion }, config);
  await build(
    { config, tracing: false, buildId: "evjs-module-reference" },
    cwd,
    cwd,
  );

  const output = path.join(cwd, "dist/client");
  const files = (await fs.readdir(output, { recursive: true })).map(
    (filename) => path.join(output, filename),
  );
  const javascript = files.filter((filename) => filename.endsWith(".js"));
  const maps = files.filter((filename) => filename.endsWith(".map"));
  const source = await Promise.all(
    [...javascript, ...maps].map((filename) => fs.readFile(filename, "utf8")),
  );
  const stats = JSON.parse(
    await fs.readFile(path.join(output, "stats.json"), "utf8"),
  );
  const entryName = plan.entries.find(
    (entry) => entry.environment === "client",
  ).name;
  const entryAssets = (stats.entrypoints[entryName]?.assets ?? [])
    .map((asset) => (typeof asset === "string" ? asset : asset.name))
    .filter((filename) => filename?.endsWith(".js"))
    .map((filename) => filename.replace(/^\.\//, ""));
  assert(entryAssets.length, "Expected emitted application entry assets.");
  const context = vm.createContext({ console, URL });
  context.self = context;
  context.location = "https://example.test/";
  context.TURBOPACK_NEXT_CHUNK_URLS = [];
  context.importScripts = (url) => {
    const filename = decodeURIComponent(
      new URL(url, context.location).pathname,
    ).slice(1);
    // Browser loading is synchronous in this worker-shaped VM host.
    vm.runInContext(readOutput(filename), context, { filename });
  };
  const outputSources = new Map(
    await Promise.all(
      javascript.map(async (filename) => [
        path.relative(output, filename).split(path.sep).join("/"),
        await fs.readFile(filename, "utf8"),
      ]),
    ),
  );
  function readOutput(filename) {
    assert(outputSources.has(filename), `Missing emitted chunk ${filename}`);
    return outputSources.get(filename);
  }
  // Use the native stats' script order, just as an HTML page does. Runtime
  // filenames follow output templates and may be inlined into the entry.
  for (const filename of entryAssets) {
    context.TURBOPACK_NEXT_CHUNK_URLS.push(
      new URL(filename, context.location).href,
    );
    vm.runInContext(readOutput(filename), context, { filename });
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert(context.GreetingFixture, "Expected the browser entry to execute.");
  process.stdout.write(
    `EVJS_NATIVE_REFERENCE_RESULT=${JSON.stringify({
      capabilityVersion: moduleReferencesVersion,
      plannedPluginId: plan.clientModuleReferences[0].pluginId,
      canonicalResource:
        plan.clientModuleReferences[0].resource ===
        (await fs.realpath(path.join(cwd, "src/greeting.js"))),
      javascriptCount: javascript.length,
      sourceMapCount: maps.length,
      originalSourceLeaked: source.some(
        (text) =>
          text.includes(implementationMarker) ||
          text.includes(sideEffectMarker),
      ),
      ...context.GreetingFixture,
      originalEvaluations: context[sideEffectMarker] ?? 0,
      ordinaryEvaluations: context.ordinaryEvaluations ?? 0,
    })}\n`,
  );
} finally {
  await prepared.dispose();
}
