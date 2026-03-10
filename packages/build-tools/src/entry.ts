import { emitCode } from "./codegen.js";
import { RUNTIME, type ServerEntryConfig } from "./types.js";

/**
 * Generate the server entry source code from discovered server modules.
 *
 * The generated entry:
 * 1. Imports user's "use server" modules (registering functions as side effects)
 * 2. Re-exports them as named exports (_fns_0, _fns_1, ...)
 * 3. Re-exports `createApp` so the adapter can create a Hono app that
 *    shares the same function registry
 *
 * The adapter layer (node/ecma) handles server startup.
 *
 * @param config - Server entry configuration (setup imports)
 * @param serverModulePaths - Absolute paths to discovered "use server" modules
 * @returns The generated server entry source code string
 */
export function generateServerEntry(
  config: ServerEntryConfig | undefined,
  serverModulePaths: string[],
): string {
  const moduleImports = serverModulePaths
    .map((p, i) => `import * as _fns_${i} from ${JSON.stringify(p)};`)
    .join("\n");

  const fnsExports = serverModulePaths.map((_p, i) => `_fns_${i}`);
  const allExports = [...fnsExports];

  return emitCode(
    [
      `export { createApp } from "${RUNTIME.appModule}";`,
      ...(config?.middleware ?? []),
      moduleImports,
      allExports.length ? `export { ${allExports.join(", ")} };` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

/**
 * Generate a standalone server entry for FaaS / server-only mode.
 *
 * Unlike `generateServerEntry`, this generates a self-contained entry that:
 * 1. Imports user's "use server" modules (registering functions)
 * 2. Creates a Hono app via `createApp`
 * 3. Exports a default fetch handler for FaaS platforms (Cloudflare Workers, Deno Deploy, etc.)
 * 4. Auto-starts a Node.js HTTP server when run directly
 *
 * @param config - Server entry configuration (middleware, endpoint)
 * @param serverModulePaths - Absolute paths to discovered "use server" modules
 * @param endpoint - Server function endpoint path (default: "/api/fn")
 * @returns The generated FaaS entry source code string
 */
export function generateFaasEntry(
  config: ServerEntryConfig | undefined,
  serverModulePaths: string[],
  endpoint?: string,
): string {
  const moduleImports = serverModulePaths
    .map((p, i) => `import * as _fns_${i} from ${JSON.stringify(p)};`)
    .join("\n");

  const endpointArg = endpoint
    ? `{ endpoint: ${JSON.stringify(endpoint)} }`
    : "";

  return emitCode(
    [
      // Middleware imports first (e.g. dotenv, instrumentation)
      ...(config?.middleware ?? []),
      // Import server modules to trigger registration
      moduleImports,
      // Import createApp and create the Hono app
      `import { createApp } from "${RUNTIME.appModule}";`,
      `const app = createApp(${endpointArg});`,
      // Export for FaaS platforms (Cloudflare Workers, Deno, Bun)
      `export default { fetch: app.fetch };`,
      // Export app for custom adapters
      `export { app };`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}
