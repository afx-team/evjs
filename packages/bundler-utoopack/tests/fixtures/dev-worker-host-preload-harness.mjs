import { createRequire } from "node:module";
import { startUtoopackDevWorker } from "../../esm/adapter/development/dev-worker-client.js";

const require = createRequire(import.meta.url);
require(require.resolve("@utoo/pack/cjs/binding.js"));

let diagnostic;
let unexpectedHandle;
try {
  unexpectedHandle = startUtoopackDevWorker({
    cwd: process.cwd(),
    config: {},
    server: {
      port: 0,
      https: false,
      hostname: "127.0.0.1",
      logServerInfo: false,
    },
  });
} catch (error) {
  diagnostic = error instanceof Error ? error.message : String(error);
}

if (!diagnostic) {
  await unexpectedHandle?.close().catch(() => {});
  throw new Error("Host-preloaded Utoopack binding was not rejected.");
}

process.stdout.write(
  `EVJS_HOST_PRELOAD_RESULT=${JSON.stringify(diagnostic)}\n`,
);
