import fs from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { execa } from "execa";
import { createJiti } from "jiti";

const [cwd, scenario] = process.argv.slice(2);
const unrefDispose = scenario === "unref-dispose";
if (scenario === "host-interrupt") {
  let interrupts = 0;
  process.on("SIGINT", () => {
    if (++interrupts === 2) process.send({ type: "host-interrupted" });
  });
}
let failWatcherClose = false;
if (scenario === "watcher-start-error") {
  process.on("uncaughtExceptionMonitor", (_error, origin) => {
    process.stderr.write(`Uncaught watcher failure: ${origin}\n`);
  });
  fs.watch = () => {
    throw Object.assign(new Error("watcher startup failed"), {
      code: "EACCES",
    });
  };
} else if (scenario === "watcher-close-error") {
  const watch = fs.watch;
  fs.watch = (...args) => {
    const watcher = watch(...args);
    const close = watcher.close.bind(watcher);
    watcher.close = () => {
      close();
      if (failWatcherClose) throw new Error("watcher close failed");
    };
    return watcher;
  };
}

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
if (!unrefDispose) {
  process.on("message", (message) => {
    if (message === "release") releaseDispose();
  });
}

let disposed = 0;
let bundlerClosed = false;
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
            const resource = unrefDispose
              ? undefined
              : execa(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"]);
            resource?.catch(() => {});
            return {
              devServerReady() {
                failWatcherClose = true;
                process.send({ type: "ready", resourcePid: resource?.pid });
              },
              async dispose() {
                disposed += 1;
                process.send({ type: "disposing" });
                if (unrefDispose) {
                  await delay(200, undefined, { ref: false });
                } else {
                  await disposeGate;
                  resource.kill();
                  await resource.catch(() => {});
                }
                await writeFile(path.join(cwd, "disposed"), "complete");
                if (scenario === "dispose-error")
                  throw new Error("resource close failed");
              },
            };
          },
        },
      ],
    },
    {
      cwd,
      ...(scenario === "forced-interrupt"
        ? { forceExitOnRepeatedInterrupt: true }
        : {}),
      bundler: {
        name: "signal-test",
        capabilities: { build: { server: true, rsc: true, ppr: true } },
        async build() {
          return {};
        },
        async dev() {
          return {
            origin: "http://localhost",
            done,
            close() {
              bundlerClosed = true;
              resolveBundler();
            },
          };
        },
      },
    },
  );
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(cwd, "closed.json"),
    JSON.stringify({
      disposed,
      bundlerClosed,
      initialListeners,
      finalListeners: signals.map((name) => process.listenerCount(name)),
    }),
  );
  process.disconnect();
}
