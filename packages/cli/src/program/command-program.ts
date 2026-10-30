import type { Config } from "@evjs/ev/config";
import type { CliFlags } from "@evjs/ev/plugin";
import { Command, CommanderError } from "commander";
import {
  formatInspectCommandErrorJson,
  type InspectCommandOptions,
  type InspectCommandResult,
} from "../commands/inspect/command.js";
import type { DefaultBundlerConfig } from "../config/load.js";
import { parseCliFlags } from "./options.js";

type FrameworkCommand = (
  config: Config<DefaultBundlerConfig> | undefined,
  options: { cwd: string; flags: CliFlags },
) => Promise<void>;

type ConfigLoader = (
  cwd: string,
  context?: { onDependency(file: string): void },
) => Promise<Config<DefaultBundlerConfig> | undefined>;

type DevFrameworkCommand = (
  config: Config<DefaultBundlerConfig> | undefined,
  options: {
    cwd: string;
    flags: CliFlags;
    loadConfig: ConfigLoader;
    /**
     * `false` when the user passed `--no-shortcuts`. `undefined` otherwise, so
     * the user's `ev.config.ts` → `dev.cliShortcuts` is authoritative.
     */
    cliShortcuts?: false;
  },
) => Promise<void>;

export interface CliProgramDependencies {
  version: string;
  cwd(): string;
  loadConfig: ConfigLoader;
  dev: DevFrameworkCommand;
  build: FrameworkCommand;
  prepare: FrameworkCommand;
  inspect(options: InspectCommandOptions): Promise<InspectCommandResult>;
  writeStdout(output: string): void;
  writeStderr(output: string): void;
  reportError(summary: string, error: unknown): void;
}

export async function runCliProgram(
  argv: readonly string[],
  dependencies: CliProgramDependencies,
): Promise<number> {
  let exitCode = 0;
  const fail = () => {
    exitCode = 1;
  };
  const runCommand = async (
    errorSummary: string,
    command: () => Promise<void>,
  ) => {
    try {
      await command();
    } catch (error) {
      dependencies.reportError(errorSummary, error);
      fail();
    }
  };

  const program = new Command()
    .name("ev")
    .description("CLI for the evjs framework")
    .version(dependencies.version)
    .exitOverride()
    .configureOutput({
      writeOut: dependencies.writeStdout,
      writeErr: dependencies.writeStderr,
    });

  program
    .command("dev")
    .description("Start development server")
    .option("--no-shortcuts", "Disable interactive CLI keyboard shortcuts")
    .allowUnknownOption(true)
    .action(async (options: { shortcuts?: boolean }, command: Command) => {
      await runCommand("Failed to start dev server", async () => {
        const cwd = dependencies.cwd();
        const flags = parseCliFlags(command.args);
        // Only inject cliShortcuts when the user passed --no-shortcuts; leave it
        // absent otherwise so the user's ev.config.ts → dev.cliShortcuts wins.
        const devOptions: {
          cwd: string;
          flags: CliFlags;
          loadConfig: ConfigLoader;
          cliShortcuts?: false;
        } = {
          cwd,
          flags,
          loadConfig: dependencies.loadConfig,
        };
        if (options.shortcuts === false) devOptions.cliShortcuts = false;
        await dependencies.dev(undefined, devOptions);
      });
    });

  program
    .command("build")
    .description("Build project for production")
    .allowUnknownOption(true)
    .action(async (_options: unknown, command: Command) => {
      await runCommand("Build failed", async () => {
        const cwd = dependencies.cwd();
        const flags = parseCliFlags(command.args);
        const config = await dependencies.loadConfig(cwd);
        await dependencies.build(config, { cwd, flags });
      });
    });

  program
    .command("prepare")
    .description("Generate .ev framework IR without running a bundler")
    .allowUnknownOption(true)
    .action(async (_options: unknown, command: Command) => {
      await runCommand("Prepare failed", async () => {
        const cwd = dependencies.cwd();
        const flags = parseCliFlags(command.args);
        const config = await dependencies.loadConfig(cwd);
        await dependencies.prepare(config, { cwd, flags });
      });
    });

  program
    .command("inspect")
    .description("Inspect evjs framework discovery without running a bundler")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      try {
        const result = await dependencies.inspect({
          cwd: dependencies.cwd(),
          json: Boolean(options.json),
        });
        dependencies.writeStdout(result.output);
        if (result.exitCode !== 0) fail();
      } catch (error) {
        if (options.json) {
          dependencies.writeStdout(formatInspectCommandErrorJson(error));
        } else {
          dependencies.reportError("Inspect failed", error);
        }
        fail();
      }
    });

  try {
    await program.parseAsync([...argv]);
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }
    dependencies.reportError("CLI failed", error);
    return 1;
  }

  return exitCode;
}
