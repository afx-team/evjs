import { inspectFrameworkBuild } from "@evjs/ev/_internal/build";
import type { DefaultBundlerConfig } from "./index.js";
import {
  formatInspectJson,
  formatInspectText,
  hasInspectErrors,
} from "./inspect.js";
import { loadConfig } from "./load-config.js";

export interface InspectCommandOptions {
  cwd?: string;
  json?: boolean;
}

export interface InspectCommandResult {
  exitCode: 0 | 1;
  output: string;
}

export async function runInspectCommand(
  options: InspectCommandOptions = {},
): Promise<InspectCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadConfig<DefaultBundlerConfig>(cwd);
  const result = await inspectFrameworkBuild<DefaultBundlerConfig>(
    config ?? undefined,
    {
      cwd,
      runLifecycleHooks: false,
    },
  );

  return {
    exitCode: hasInspectErrors(result) ? 1 : 0,
    output: options.json
      ? formatInspectJson(result)
      : formatInspectText(result),
  };
}

export function formatInspectCommandErrorJson(error: unknown): string {
  return `${JSON.stringify(
    {
      diagnostics: [
        {
          level: "error",
          source: "config",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    },
    null,
    2,
  )}\n`;
}
