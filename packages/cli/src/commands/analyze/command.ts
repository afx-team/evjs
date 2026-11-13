import path from "node:path";
import type { Config } from "@evjs/ev/config";
import type { CliFlags } from "@evjs/ev/plugin";
import { type Command, InvalidArgumentError, Option } from "commander";
import type { DefaultBundlerConfig } from "../../config/load.js";
import { parseCliFlags } from "../../program/options.js";

interface ExportFilters {
  entry?: string;
  environment?: "client" | "server";
}

interface CaptureOptions {
  output?: boolean;
  outputDir?: string;
  port?: number;
}

export interface BundleAnalysisActions {
  capture(
    config: Config<DefaultBundlerConfig> | undefined,
    options: { cwd: string; flags: CliFlags; outputPath?: string },
  ): Promise<{ outputPath: string }>;
  serveReport(reportPath: string, port?: number): Promise<{ url: string }>;
  exportReport(
    reportPath: string,
    filters: ExportFilters,
  ): AsyncIterable<object>;
  writeJsonLine(line: string): void | Promise<void>;
}

interface AnalyzeCommandDependencies {
  analysis: BundleAnalysisActions;
  cwd(): string;
  loadConfig(cwd: string): Promise<Config<DefaultBundlerConfig> | undefined>;
  writeStdout(output: string): void;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port > 65535) {
    throw new InvalidArgumentError(
      "Analyzer port must be an integer between 0 and 65535.",
    );
  }
  return port;
}

export function registerAnalyzeCommand(
  program: Command,
  dependencies: AnalyzeCommandDependencies,
  runCommand: (summary: string, command: () => Promise<void>) => Promise<void>,
): void {
  const analyze = program
    .command("analyze")
    .description("Analyze production bundles with Utoopack")
    .enablePositionalOptions()
    .allowUnknownOption(true)
    .option("-o, --output", "Write the report without starting a server")
    .option(
      "--output-dir <directory>",
      "Report directory relative to the project (default: .utoo/analyze)",
    )
    .option(
      "--port <port>",
      "Local report server port (default: 4000)",
      parsePort,
    )
    .action(async (options: CaptureOptions, command: Command) => {
      await runCommand("Analysis failed", async () => {
        const cwd = dependencies.cwd();
        const flags = parseCliFlags(command.args);
        const config = await dependencies.loadConfig(cwd);
        const report = await dependencies.analysis.capture(config, {
          cwd,
          flags,
          outputPath: options.outputDir,
        });
        dependencies.writeStdout(
          `Analyzer report written to ${report.outputPath}\n`,
        );
        if (!options.output) {
          const server = await dependencies.analysis.serveReport(
            report.outputPath,
            options.port,
          );
          dependencies.writeStdout(
            `Bundle Analyzer available at ${server.url}\n`,
          );
        }
      });
    });

  analyze
    .command("export")
    .description("Export a saved report as JSONL without compiling")
    .allowExcessArguments(false)
    .allowUnknownOption(false)
    .option(
      "--report <directory>",
      "Saved report directory, relative to the current directory",
      ".utoo/analyze",
    )
    .option("--entry <name>", "Filter by entry name or /entry-N ID")
    .addOption(
      new Option(
        "--environment <environment>",
        "Filter by entry environment",
      ).choices(["client", "server"]),
    )
    .action(
      async (options: ExportFilters & { report: string }, command: Command) => {
        // Commander can parse options owned by the parent before dispatching
        // the subcommand. Do not silently ignore capture options on export.
        const capture = analyze.opts<CaptureOptions>();
        if (
          capture.output ||
          capture.outputDir !== undefined ||
          capture.port !== undefined
        ) {
          command.error(
            "error: --output, --output-dir and --port are only supported by ev analyze (capture).",
          );
        }
        await runCommand("Analysis export failed", async () => {
          const reportPath = path.resolve(dependencies.cwd(), options.report);
          try {
            for await (const record of dependencies.analysis.exportReport(
              reportPath,
              { entry: options.entry, environment: options.environment },
            )) {
              await dependencies.analysis.writeJsonLine(
                `${JSON.stringify(record)}\n`,
              );
            }
          } catch (error) {
            // A pipe consumer such as `head` can stop reading early.
            if ((error as NodeJS.ErrnoException | null)?.code !== "EPIPE") {
              throw error;
            }
          }
        });
      },
    );
}
