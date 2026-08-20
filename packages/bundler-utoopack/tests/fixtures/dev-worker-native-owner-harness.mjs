import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { markUtoopackProcessForBuild } from "../../esm/adapter/development/dev-process-mode.js";
import {
  __testing as ownerTesting,
  startUtoopackDevWorker,
} from "../../esm/adapter/development/dev-worker-client.js";

const [cwd, loaderPath, requestedPort] = process.argv.slice(2);
if (!cwd || !loaderPath || !requestedPort) {
  throw new Error("Native owner harness requires cwd, loader path, and port.");
}
const require = createRequire(import.meta.url);
const bindingPath = require.resolve("@utoo/pack/cjs/binding.js");
const config = createConfig(loaderPath);

const first = await runSession(config, Number(requestedPort));
const firstOwnerThreadId = ownerTesting.getNativeOwnerThreadId();
await fs.promises.writeFile(path.join(cwd, "src/message.foo"), "B\n");
await fs.promises.rm(path.join(cwd, "dist"), {
  recursive: true,
  force: true,
});
const second = await runSession(config, first.port);
const secondOwnerThreadId = ownerTesting.getNativeOwnerThreadId();
let buildModeRejected = false;
try {
  markUtoopackProcessForBuild();
} catch (error) {
  buildModeRejected = String(error).includes(
    "build cannot run in a process that already hosted dev",
  );
}

process.stdout.write(
  `EVJS_NATIVE_OWNER_RESULT=${JSON.stringify({
    firstOwnerThreadId,
    secondOwnerThreadId,
    hostLoadedBinding: require.cache[bindingPath] !== undefined,
    buildModeRejected,
    firstPort: first.port,
    secondPort: second.port,
  })}\n`,
);

function createConfig(customLoaderPath) {
  return {
    mode: "development",
    entry: [{ import: "./src/index.js", name: "main" }],
    output: {
      path: "./dist/client",
      filename: "[name].js",
      chunkFilename: "[name].js",
      clean: true,
      publicPath: "auto",
    },
    persistentCaching: true,
    pluginRuntimeStrategy: "workerThreads",
    module: {
      rules: {
        "*.foo": {
          loaders: [{ loader: customLoaderPath }],
          as: "*.js",
        },
      },
    },
    sourceMaps: true,
    stats: true,
  };
}

async function runSession(config, port) {
  const handle = startUtoopackDevWorker({
    cwd,
    config,
    server: {
      port,
      https: false,
      hostname: "127.0.0.1",
      logServerInfo: false,
    },
  });
  try {
    const ready = await handle.ready;
    const stats = await fs.promises.readFile(
      path.join(cwd, "dist/client/stats.json"),
      "utf8",
    );
    if (!stats.includes("entrypoints")) {
      throw new Error("Native owner did not write Utoopack entrypoint stats.");
    }
    await handle.close();
    await handle.done;
    await assertPortAvailable(ready.port);
    return ready;
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

async function assertPortAvailable(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
