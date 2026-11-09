import { createRequire } from "node:module";
import type {
  BundlerAnalyzeContext,
  BundlerAnalyzeResult,
} from "@evjs/ev/_internal/build";
import type { ConfigComplete } from "@utoo/pack";
import { markUtoopackProcessForBuild } from "../development/dev-process-mode.js";

interface AnalyzeReportServer {
  url: string;
  close(): Promise<void>;
}

interface AnalyzeExportOptions {
  entry?: string;
  environment?: "client" | "server";
}

interface PackAnalyzer {
  analyze(
    options: { config: ConfigComplete },
    projectPath: string,
    rootPath: undefined,
    analyzeOptions: { outputPath?: string },
  ): Promise<BundlerAnalyzeResult>;
  serveAnalyzeReport(
    reportPath: string,
    port?: number,
  ): Promise<AnalyzeReportServer>;
}

interface PackReportExporter {
  exportAnalyzeReport(
    reportPath: string,
    options?: AnalyzeExportOptions,
  ): AsyncIterable<Record<string, unknown>>;
}

const require = createRequire(import.meta.url);

function unsupportedAnalyzer(): Error {
  const { version } = require("@utoo/pack/package.json") as { version: string };
  return new Error(
    `[evjs] @utoo/pack@${version} does not support the native Bundle Analyzer. Use an Analyzer-capable Pack version (for example, 1.5.40-alpha.1 for this preview).`,
  );
}

export async function captureUtoopackAnalysis(
  ctx: BundlerAnalyzeContext<ConfigComplete>,
): Promise<BundlerAnalyzeResult> {
  markUtoopackProcessForBuild();
  const runtime = require("@utoo/pack") as Partial<PackAnalyzer>;
  if (typeof runtime.analyze !== "function") throw unsupportedAnalyzer();

  const { createUtoopackConfig } = await import("../config/create-config.js");
  const config = await createUtoopackConfig(
    ctx.config,
    ctx.plan,
    ctx.cwd,
    ctx.hooks,
    ctx.addWatchFile,
  );
  return runtime.analyze({ config }, ctx.cwd, undefined, {
    outputPath: ctx.outputPath,
  });
}

export async function serveBundleAnalysisReport(
  reportPath: string,
  port?: number,
): Promise<AnalyzeReportServer> {
  const runtime = require("@utoo/pack") as Partial<PackAnalyzer>;
  if (typeof runtime.serveAnalyzeReport !== "function")
    throw unsupportedAnalyzer();
  return runtime.serveAnalyzeReport(reportPath, port);
}

export function exportBundleAnalysisReport(
  reportPath: string,
  options?: AnalyzeExportOptions,
): AsyncIterable<Record<string, unknown>> {
  // The report-only subpath does not load the native compiler or project config.
  let exporter: string;
  try {
    exporter = require.resolve("@utoo/pack/analyze");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ERR_PACKAGE_PATH_NOT_EXPORTED" || code === "MODULE_NOT_FOUND")
      throw unsupportedAnalyzer();
    throw error;
  }
  const runtime = require(exporter) as Partial<PackReportExporter>;
  if (typeof runtime.exportAnalyzeReport !== "function")
    throw unsupportedAnalyzer();
  return runtime.exportAnalyzeReport(reportPath, options);
}
