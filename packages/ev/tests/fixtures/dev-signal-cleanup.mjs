import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { createJiti } from "jiti";

const [cwd, failDispose] = process.argv.slice(2);
const jiti = createJiti(import.meta.url);
const { dev } = await jiti.import(
  new URL("../../src/_internal/build/commands.ts", import.meta.url).href,
);
const signals = ["SIGINT", "SIGTERM"];
const initialListeners = signals.map((name) => process.listenerCount(name));
let releaseDispose;
const disposeGate = new Promise((resolve) => {
  releaseDispose = resolve;
});
process.on("message", (message) => {
  if (message === "release") releaseDispose();
});

let disposed = 0;
let resolveBundler;
const done = new Promise((resolve) => {
  resolveBundler = resolve;
});
try {
  await dev(
    {
      dev: { cliShortcuts: false },
      plugins: [
        {
          id: "async-resource",
          setup() {
            const resource = execa(process.execPath, [
              "-e",
              "setTimeout(() => {}, 30_000)",
            ]);
            resource.catch(() => {});
            return {
              devServerReady() {
                process.send({ type: "ready", resourcePid: resource.pid });
              },
              async dispose() {
                disposed += 1;
                process.send({ type: "disposing" });
                await disposeGate;
                resource.kill();
                await resource.catch(() => {});
                await fs.writeFile(path.join(cwd, "disposed"), "complete");
                if (failDispose === "true")
                  throw new Error("resource close failed");
              },
            };
          },
        },
      ],
    },
    {
      cwd,
      bundler: {
        name: "signal-test",
        capabilities: { build: { server: true, rsc: true, ppr: true } },
        async build() {
          return {};
        },
        async dev() {
          return { origin: "http://localhost", done, close: resolveBundler };
        },
      },
    },
  );
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
} finally {
  await fs.writeFile(
    path.join(cwd, "closed.json"),
    JSON.stringify({
      disposed,
      initialListeners,
      finalListeners: signals.map((name) => process.listenerCount(name)),
    }),
  );
  process.disconnect();
}
