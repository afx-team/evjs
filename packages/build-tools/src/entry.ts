import { emitCode } from "./codegen.js";
import type { ServerEntryConfig } from "./types.js";
import { parseModuleRef } from "./utils.js";

/**
 * Generate the server entry source code from discovered server modules
 * and configuration. This is a pure function with no bundler dependency.
 *
 * @param config - Server entry configuration (app factory, runner, setup)
 * @param serverModulePaths - Absolute paths to discovered "use server" modules
 * @returns The generated server entry source code string
 */
export function generateServerEntry(
  config: ServerEntryConfig | undefined,
  serverModulePaths: string[],
): string {
  const appFactoryRef = config?.appFactory ?? "@evjs/runtime/server#createApp";
  const appFactory = parseModuleRef(appFactoryRef);

  let runner: { module: string; exportName: string } | null = null;
  if (config?.runner) {
    runner = parseModuleRef(config.runner);
  }

  const appImport =
    runner && runner.module === appFactory.module
      ? `import { ${appFactory.exportName}, ${runner.exportName} } from ${JSON.stringify(appFactory.module)};`
      : `import { ${appFactory.exportName} } from ${JSON.stringify(appFactory.module)};`;

  const runnerImport =
    runner && runner.module !== appFactory.module
      ? `import { ${runner.exportName} } from ${JSON.stringify(runner.module)};`
      : "";

  const moduleImports = serverModulePaths
    .map((p, i) => `import * as _fns_${i} from ${JSON.stringify(p)};`)
    .join("\n");

  const tail = runner ? `${runner.exportName}(app);` : "export default app;";

  return emitCode(
    [
      appImport,
      runnerImport,
      ...(config?.setup ?? []),
      moduleImports,
      `const app = ${appFactory.exportName}();`,
      tail,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}
