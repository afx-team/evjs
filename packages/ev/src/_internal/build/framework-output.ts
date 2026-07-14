import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createApp } from "@evjs/server/app";
import type { AppGraph, BuildOutput, BuildPlan } from "@evjs/shared/manifest";
import {
  assertFrameworkManifestShape,
  createDeploymentMetadata,
  createPublicManifest,
  createServerManifest,
  linkBuildOutput,
} from "@evjs/shared/manifest";
import type { ResolvedConfig } from "../../config/index.js";
import type {
  HtmlDocumentInfo,
  PluginContext,
  PluginHooks,
} from "../../plugin/index.js";
import type { BundlerBuildFacts } from "./bundler.js";
import {
  createClientRuntime,
  createFrameworkRuntime,
} from "./framework-runtime.js";
import { applyHtmlTagContributions } from "./generated-contributions.js";
import { generateHtml, type HtmlAsset, validateHtmlTemplate } from "./html.js";
import { buildHtml } from "./html-transform.js";
import { runBuildOutputHooks } from "./plugin-lifecycle.js";

const MANIFEST_FILE = "manifest.json";
const CLIENT_RUNTIME_SCRIPT_ID = "__EVJS_CLIENT_RUNTIME__";
const LEGACY_RUNTIME_FILE = "runtime.json";
const LEGACY_FRAMEWORK_RUNTIME_FILE = "framework-runtime.json";
const BUILD_OUTPUT_FILE = "build-output.json";
const RUNTIME_ONLY_BUNDLER_MANIFEST_FILES = [
  "react-client-manifest.json",
  "react-ssr-manifest.json",
];

export function validateHtmlTemplates<TBundlerCfg>(
  cwd: string,
  config: ResolvedConfig<TBundlerCfg>,
): void {
  const templates = collectHtmlTemplates(config);
  const documents = new Map<string, HtmlTemplateDocument>();

  for (const template of templates) {
    const templatePath = path.resolve(cwd, template.path);
    let doc = documents.get(templatePath);
    if (!doc) {
      doc = readHtmlTemplateDocument(templatePath, template);
      documents.set(templatePath, doc);
    }
    validateHtmlMountTarget(template, doc);
  }
}

type HtmlTemplateDocument = ReturnType<typeof validateHtmlTemplate>;

interface HtmlTemplateValidation {
  path: string;
  notFoundMessage: string;
  notFileMessage: string;
  mount?: string;
  mountNotFoundMessage?: string;
  mountInvalidMessage?: string;
}

function readHtmlTemplateDocument(
  templatePath: string,
  template: HtmlTemplateValidation,
): HtmlTemplateDocument {
  let stat: ReturnType<typeof fs.statSync>;
  try {
    stat = fs.statSync(templatePath);
  } catch {
    throw new Error(`${template.notFoundMessage}: ${template.path}`);
  }

  if (!stat.isFile()) {
    throw new Error(`${template.notFileMessage}: ${template.path}`);
  }
  return validateHtmlTemplate({
    template: templatePath,
    displayName: template.path,
  });
}

function validateHtmlMountTarget(
  template: HtmlTemplateValidation,
  doc: HtmlTemplateDocument,
): void {
  if (!template.mount) return;
  const mountInvalidMessage =
    template.mountInvalidMessage ?? "[evjs] HTML mount selector is invalid";
  const mountNotFoundMessage =
    template.mountNotFoundMessage ?? "[evjs] HTML mount target was not found";

  let target: unknown;
  try {
    target = doc.querySelector(template.mount);
  } catch {
    throw new Error(`${mountInvalidMessage}: ${template.mount}`);
  }

  if (!target) {
    throw new Error(
      `${mountNotFoundMessage} "${template.mount}" in html template: ${template.path}`,
    );
  }
}

function collectHtmlTemplates<TBundlerCfg>(
  config: ResolvedConfig<TBundlerCfg>,
): HtmlTemplateValidation[] {
  const templates: HtmlTemplateValidation[] = [];

  for (const [appId, app] of Object.entries(config.apps ?? {})) {
    templates.push({
      path: app.html ?? config.html,
      notFoundMessage: `[evjs] App "${appId}" html template not found`,
      notFileMessage: `[evjs] App "${appId}" html template must be a file`,
      mount: app.mount,
      mountNotFoundMessage: `[evjs] App "${appId}" mount target was not found`,
      mountInvalidMessage: `[evjs] App "${appId}" mount selector is invalid`,
    });
  }

  for (const [pageId, page] of Object.entries(config.pages ?? {})) {
    templates.push({
      path: page.html,
      notFoundMessage: `[evjs] MPA page "${pageId}" html template not found`,
      notFileMessage: `[evjs] MPA page "${pageId}" html template must be a file`,
      mount: page.mount,
      mountNotFoundMessage: `[evjs] MPA page "${pageId}" mount target was not found`,
      mountInvalidMessage: `[evjs] MPA page "${pageId}" mount selector is invalid`,
    });
  }

  if (config.routing?.mode === "mpa") {
    let usesRoutingHtml = false;
    for (const route of config.routing.routes) {
      if (route.kind === "layout") continue;
      if (route.html) {
        templates.push({
          path: route.html,
          notFoundMessage: `[evjs] MPA page route "${route.id}" html template not found`,
          notFileMessage: `[evjs] MPA page route "${route.id}" html template must be a file`,
          mount: config.routing.mount,
          mountNotFoundMessage: `[evjs] MPA page route "${route.id}" mount target was not found`,
          mountInvalidMessage: `[evjs] MPA page route "${route.id}" mount selector is invalid`,
        });
      } else {
        usesRoutingHtml = true;
      }
    }
    if (usesRoutingHtml) {
      templates.push({
        path: config.routing.html,
        notFoundMessage: "[evjs] Page routing html template not found",
        notFileMessage: "[evjs] Page routing html template must be a file",
        mount: config.routing.mount,
        mountNotFoundMessage: "[evjs] Page routing mount target was not found",
        mountInvalidMessage: "[evjs] Page routing mount selector is invalid",
      });
    }
  } else if (config.routing) {
    templates.push({
      path: config.routing.html,
      notFoundMessage: "[evjs] Page routing html template not found",
      notFileMessage: "[evjs] Page routing html template must be a file",
      mount: config.routing.mount,
      mountNotFoundMessage: "[evjs] Page routing mount target was not found",
      mountInvalidMessage: "[evjs] Page routing mount selector is invalid",
    });
  }

  if (templates.length === 0) {
    templates.push({
      path: config.html,
      notFoundMessage: "[evjs] HTML template not found",
      notFileMessage: "[evjs] HTML template must be a file",
    });
  }

  return templates;
}

function getFrameworkOutputPaths(
  cwd: string,
  output: BuildOutput,
): { rootDir: string; clientDir: string; serverDir: string } {
  const rootDir = path.resolve(cwd, output.paths.rootDir);
  const publicDir = output.paths.publicDir;
  const serverDir = output.paths.serverDir;
  return {
    rootDir,
    clientDir: path.resolve(cwd, publicDir),
    serverDir: path.resolve(cwd, serverDir),
  };
}

async function emitFrameworkManifest(
  cwd: string,
  output: BuildOutput,
): Promise<void> {
  const { rootDir, clientDir, serverDir } = getFrameworkOutputPaths(
    cwd,
    output,
  );
  await fs.promises.mkdir(rootDir, { recursive: true });
  const serverManifest = createServerManifest(output);
  if (serverManifest.entry || serverManifest.routes.length > 0) {
    await fs.promises.mkdir(serverDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(serverDir, MANIFEST_FILE),
      JSON.stringify(serverManifest, null, 2),
      "utf-8",
    );
  }
  await fs.promises.writeFile(
    path.join(rootDir, BUILD_OUTPUT_FILE),
    JSON.stringify(createDeploymentMetadata(output), null, 2),
    "utf-8",
  );
  await fs.promises.rm(path.join(serverDir, BUILD_OUTPUT_FILE), {
    force: true,
  });
  await removeFrameworkOutputFileIfInactive(rootDir, MANIFEST_FILE, [
    clientDir,
    serverDir,
  ]);
  await removeFrameworkOutputFileIfInactive(rootDir, LEGACY_RUNTIME_FILE, [
    clientDir,
    serverDir,
  ]);
  await removeFrameworkOutputFileIfInactive(
    path.join(rootDir, "client"),
    MANIFEST_FILE,
    [clientDir, serverDir],
  );
  await removeFrameworkOutputFileIfInactive(
    path.join(rootDir, "client"),
    LEGACY_RUNTIME_FILE,
    [clientDir, serverDir],
  );
  await removeFrameworkOutputFileIfInactive(
    path.join(rootDir, "server"),
    MANIFEST_FILE,
    [clientDir, serverDir],
  );
  await removeFrameworkOutputFileIfInactive(
    path.join(rootDir, "server"),
    LEGACY_RUNTIME_FILE,
    [clientDir, serverDir],
  );
  await removeFrameworkOutputFileIfInactive(
    path.join(rootDir, "server"),
    LEGACY_FRAMEWORK_RUNTIME_FILE,
    [clientDir, serverDir],
  );

  const publicManifest = createPublicManifest(output);
  await fs.promises.mkdir(clientDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(clientDir, MANIFEST_FILE),
    JSON.stringify(publicManifest, null, 2),
    "utf-8",
  );
  await fs.promises.rm(path.join(clientDir, LEGACY_RUNTIME_FILE), {
    force: true,
  });
  if (output.server.entry) {
    await fs.promises.mkdir(serverDir, { recursive: true });
    await fs.promises.rm(path.join(serverDir, LEGACY_RUNTIME_FILE), {
      force: true,
    });
  }
  await fs.promises.rm(path.join(serverDir, LEGACY_FRAMEWORK_RUNTIME_FILE), {
    force: true,
  });
  await removeRuntimeOnlyBundlerManifests(clientDir);
}

async function removeRuntimeOnlyBundlerManifests(
  clientDir: string,
): Promise<void> {
  await Promise.all(
    RUNTIME_ONLY_BUNDLER_MANIFEST_FILES.map((fileName) =>
      fs.promises.rm(path.join(clientDir, fileName), { force: true }),
    ),
  );
}

async function removeFrameworkOutputFileIfInactive(
  dir: string,
  fileName: string,
  activeDirs: string[],
): Promise<void> {
  const normalizedDir = path.resolve(dir);
  if (
    activeDirs.some((activeDir) => path.resolve(activeDir) === normalizedDir)
  ) {
    return;
  }
  await fs.promises.rm(path.join(normalizedDir, fileName), {
    force: true,
  });
}

function getHtmlAssets(html: BuildPlan["html"][number], output: BuildOutput) {
  const pageId = html.owner.pageId;
  const appId = html.owner.appId;
  return pageId
    ? output.pages[pageId]?.assets
    : appId
      ? output.apps[appId]?.assets
      : undefined;
}

function createHtmlDocumentInfo(
  html: BuildPlan["html"][number],
  output: BuildOutput,
): HtmlDocumentInfo | undefined {
  const assets = getHtmlAssets(html, output);
  if (!assets) return undefined;

  if (html.owner.pageId) {
    return {
      kind: "page",
      htmlId: html.id,
      pageId: html.owner.pageId,
      template: html.template,
      fileName: html.fileName,
      assets,
    };
  }

  return {
    kind: "app",
    htmlId: html.id,
    appId: html.owner.appId ?? "default",
    template: html.template,
    fileName: html.fileName,
    assets,
  };
}

function withHtmlAssetCrossOrigin(
  assets: string[],
  crossOriginLoading: ResolvedConfig["output"]["crossOriginLoading"],
): HtmlAsset[] {
  if (!crossOriginLoading) return assets;
  return assets.map((url) => ({
    url,
    attrs: { crossorigin: crossOriginLoading },
  }));
}

async function emitFrameworkHtml<TBundlerCfg>(
  cwd: string,
  config: ResolvedConfig<TBundlerCfg>,
  hooks: PluginHooks<TBundlerCfg>[],
  pluginCtx: PluginContext<TBundlerCfg>,
  output: BuildOutput,
  plan: BuildPlan,
  frameworkRuntime: ReturnType<typeof createFrameworkRuntime>,
  isRebuild: boolean,
  loadServerModule?: (asset: string) => Promise<unknown>,
): Promise<void> {
  const { clientDir, serverDir } = getFrameworkOutputPaths(cwd, output);
  const clientRuntime = createClientRuntime(output);

  for (const html of plan.html) {
    const htmlInfo = createHtmlDocumentInfo(html, output);
    if (!htmlInfo) continue;

    const doc = generateHtml({
      template: path.resolve(cwd, html.template),
      js: withHtmlAssetCrossOrigin(
        htmlInfo.assets.js,
        config.output.crossOriginLoading,
      ),
      css: withHtmlAssetCrossOrigin(
        htmlInfo.assets.css,
        config.output.crossOriginLoading,
      ),
    });
    doc.documentElement?.setAttribute("data-evjs-build", output.buildId);
    if (htmlInfo.kind === "page") {
      doc.documentElement?.setAttribute("data-evjs-kind", "page");
      doc.documentElement?.setAttribute("data-evjs-id", htmlInfo.pageId);
    } else {
      doc.documentElement?.setAttribute("data-evjs-kind", "app");
      doc.documentElement?.setAttribute("data-evjs-id", htmlInfo.appId);
    }
    if (htmlInfo.assets.js.length > 0) {
      embedClientRuntime(doc, clientRuntime);
    }
    applyHtmlTagContributions(doc, htmlInfo, plan);
    if (
      plan.mode === "production" &&
      shouldPrerenderStaticPage(output, htmlInfo)
    ) {
      await prerenderStaticPageHtml({
        doc,
        output,
        html: htmlInfo,
        frameworkRuntime,
        serverDir,
        loadServerModule,
      });
    }

    const finalHtml = await buildHtml({
      doc,
      hooks,
      pluginContext: pluginCtx,
      html: htmlInfo,
      output,
      isRebuild,
    });

    const outPath = path.join(clientDir, html.fileName);
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.writeFile(outPath, finalHtml, "utf-8");
  }
}

function shouldPrerenderStaticPage(
  output: BuildOutput,
  html: HtmlDocumentInfo,
): html is Extract<HtmlDocumentInfo, { kind: "page" }> {
  if (html.kind !== "page") return false;
  const page = output.pages[html.pageId];
  return Boolean(
    page &&
      page.render === "ssg" &&
      page.rendering.html === "static" &&
      page.rendering.prerender === "full",
  );
}

async function prerenderStaticPageHtml(options: {
  doc: ReturnType<typeof generateHtml>;
  output: BuildOutput;
  html: Extract<HtmlDocumentInfo, { kind: "page" }>;
  frameworkRuntime: ReturnType<typeof createFrameworkRuntime>;
  serverDir: string;
  loadServerModule?: (asset: string) => Promise<unknown>;
}): Promise<void> {
  const { doc, output, html, frameworkRuntime, serverDir, loadServerModule } =
    options;
  const page = output.pages[html.pageId];
  const pathname = findStaticPagePath(output, html.pageId, page);
  if (!page || !pathname) return;

  const { createReactFrameworkServer } = await import("@evjs/server/react");
  const framework = createReactFrameworkServer({
    runtime: frameworkRuntime,
    loadModule: async (asset) =>
      normalizeServerModule(
        loadServerModule
          ? await loadServerModule(asset)
          : await import(pathToFileURL(path.resolve(serverDir, asset)).href),
      ),
    react: {
      renderDocument(appHtml) {
        return appHtml;
      },
    },
  });
  if (!framework?.render) {
    throw new Error(
      `[evjs] Unable to prerender SSG page "${html.pageId}" because no server renderer was emitted.`,
    );
  }

  const app = createApp({ framework });
  const response = await app.fetch(
    new Request(new URL(pathname, "http://evjs.local").toString(), {
      method: "GET",
    }),
  );
  if (!response.ok) {
    throw new Error(
      `[evjs] Failed to prerender SSG page "${html.pageId}": ${response.status} ${response.statusText}`,
    );
  }

  const mount = doc.querySelector(page.mount ?? "#app");
  if (!mount) {
    throw new Error(
      `[evjs] Unable to prerender SSG page "${html.pageId}" because mount target "${page.mount ?? "#app"}" was not found.`,
    );
  }
  mount.innerHTML = await response.text();
}

function findStaticPagePath(
  output: BuildOutput,
  pageId: string,
  page: BuildOutput["pages"][string] | undefined,
): string | undefined {
  const routePath = output.routes.find(
    (route) => route.pageId === pageId,
  )?.path;
  const pathname = routePath ?? page?.path;
  if (!pathname || !isStaticPagePath(pathname)) return undefined;
  return pathname;
}

function isStaticPagePath(pathname: string): boolean {
  return !/(^|\/)(?:[$:]|[*])/.test(pathname);
}

function normalizeServerModule(mod: unknown): Record<string, unknown> {
  const nested =
    mod && typeof mod === "object" && "default" in mod
      ? (mod as { default?: unknown }).default
      : undefined;
  return nested &&
    typeof nested === "object" &&
    ("default" in nested || "render" in nested || "fetch" in nested)
    ? (nested as Record<string, unknown>)
    : (mod as Record<string, unknown>);
}

function embedClientRuntime(
  doc: ReturnType<typeof generateHtml>,
  runtime: ReturnType<typeof createClientRuntime>,
): void {
  const body = doc.body ?? doc.querySelector("body");
  if (!body) return;
  const json = JSON.stringify(runtime)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const script = doc.createElement("script");
  script.id = CLIENT_RUNTIME_SCRIPT_ID;
  script.setAttribute("type", "application/json");
  script.textContent = json;
  const firstScript = body.querySelector("script[src]");
  if (firstScript) {
    body.insertBefore(script, firstScript);
    return;
  }
  body.appendChild(script);
}

export async function linkAndEmitBuildOutput<TBundlerCfg>(options: {
  bundlerFacts: BundlerBuildFacts;
  graph: AppGraph;
  plan: BuildPlan;
  config: ResolvedConfig<TBundlerCfg>;
  cwd: string;
  hooks: PluginHooks<TBundlerCfg>[];
  pluginCtx: PluginContext<TBundlerCfg>;
  isRebuild: boolean;
}): Promise<{
  output: BuildOutput;
  frameworkRuntime: ReturnType<typeof createFrameworkRuntime>;
}> {
  const output = linkBuildOutput({
    graph: options.graph,
    plan: options.plan,
    clientEntryAssets: options.bundlerFacts.clientEntryAssets,
    firstClientEntryAssets: options.bundlerFacts.firstClientEntryAssets,
    serverEntryAssets: options.bundlerFacts.serverEntryAssets,
    serverEntry: options.bundlerFacts.serverEntry,
    serverAssets: options.bundlerFacts.serverAssets,
    serverModules: options.bundlerFacts.serverModules,
  });

  await runBuildOutputHooks(options.hooks, output, options.pluginCtx);
  assertFrameworkManifestShape(output, "BuildOutput after buildOutput hooks");
  const frameworkRuntime = createFrameworkRuntime(output, {
    rscManifests: options.bundlerFacts.rscManifests,
  });
  await emitFrameworkManifest(options.cwd, output);
  await emitFrameworkHtml(
    options.cwd,
    options.config,
    options.hooks,
    options.pluginCtx,
    output,
    options.plan,
    frameworkRuntime,
    options.isRebuild,
    options.bundlerFacts.loadServerModule,
  );

  return { output, frameworkRuntime };
}
