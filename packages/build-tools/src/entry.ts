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
