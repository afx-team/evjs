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
const serverConfig = {
  ...config,
  server: {
    entry: "./src/server.js",
    output: { path: "./dist/server", filename: "[name].js" },
  },
};
const server = await runSession(serverConfig, second.port, true);
const serverOwnerThreadId = ownerTesting.getNativeOwnerThreadId();
await runSession(serverConfig, server.port);
const serverSessionReused =
  serverOwnerThreadId === firstOwnerThreadId &&
  ownerTesting.getNativeOwnerThreadId() === firstOwnerThreadId;
await runSession(config, server.port, false, true);
const client = await runSession(config, server.port);
const clientSessionReused =
  ownerTesting.getNativeOwnerThreadId() === firstOwnerThreadId;
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
    serverPublicationClosed: server.publicationClosed,
    serverSessionReused,
    clientPublicationClosed: clientSessionReused && client.clientPublished,
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

async function runSession(
  config,
  port,
  blockPublication = false,
  blockClientPublication = false,
) {
  let beginPublication;
  let rejectPublication;
  let releasePublication;
  let publicationBlocked = false;
  let clientPublished = false;
  let beginClientPublication;
  const clientPublication = new Promise((resolve) => {
    beginClientPublication = resolve;
  });
  const publication = new Promise((resolve, reject) => {
    beginPublication = resolve;
    rejectPublication = reject;
  });
  void publication.catch(() => {});
  const publicationGate = new Promise((resolve) => {
    releasePublication = resolve;
  });
  const handle = startUtoopackDevWorker({
    cwd,
    config,
    async onClientBuild({ clientPaths }) {
      const stats = await fs.promises.readFile(
        path.join(cwd, "dist/client/stats.json"),
        "utf8",
      );
      if (!clientPaths.length || !stats.includes("entrypoints")) {
        throw new Error(
          "Client publication ran before its outputs were ready.",
        );
      }
      clientPublished = true;
      beginClientPublication();
      if (blockClientPublication) await publicationGate;
    },
    async onServerBuild() {
      try {
        const stats = JSON.parse(
          await fs.promises.readFile(
            path.join(cwd, "dist/server/stats.json"),
            "utf8",
          ),
        );
        if (
          !Array.isArray(stats.assets) ||
          !stats.assets.length ||
          !Object.keys(stats.entrypoints ?? {}).length
        ) {
          throw new Error(
            "Native server publication has no valid canonical stats.",
          );
        }
      } catch (error) {
        rejectPublication(error);
        throw error;
      }
      publicationBlocked = blockPublication;
      beginPublication();
      if (blockPublication) await publicationGate;
    },
    onServerError: rejectPublication,
    server: {
      port,
      https: false,
      hostname: "127.0.0.1",
      logServerInfo: false,
    },
  });
  try {
    if (blockClientPublication) {
      await clientPublication;
      await handle.close();
      await handle.done;
      return;
    }
    const ready = await handle.ready;
    if (!clientPublished)
      throw new Error("Missing initial client publication.");
    const stats = await fs.promises.readFile(
      path.join(cwd, "dist/client/stats.json"),
      "utf8",
    );
    if (!stats.includes("entrypoints")) {
      throw new Error("Native owner did not write Utoopack entrypoint stats.");
    }
    if (config.server) await publication;
    await handle.close();
    await handle.done;
    await assertPortAvailable(ready.port);
    return { ...ready, publicationClosed: publicationBlocked, clientPublished };
  } finally {
    releasePublication();
    await handle.close().catch(() => {});
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
