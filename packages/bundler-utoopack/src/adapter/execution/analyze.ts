import { createRequire } from "node:module";
import type {
  BundlerAnalyzeContext,
  BundlerAnalyzeResult,
} from "@evjs/ev/_internal/build";
import type { ConfigComplete } from "@utoo/pack";
import type { AnalyzeExportOptions } from "@utoo/pack/analyze";
import { assertUtoopackModuleReferenceSupport } from "../config/module-references.js";
import { markUtoopackProcessForBuild } from "../development/dev-process-mode.js";

const require = createRequire(import.meta.url);

export async function captureUtoopackAnalysis(
  ctx: BundlerAnalyzeContext<ConfigComplete>,
): Promise<BundlerAnalyzeResult> {
  markUtoopackProcessForBuild();
  const { createUtoopackConfig } = await import("../config/create-config.js");
  const config = await createUtoopackConfig(
    ctx.config,
    ctx.plan,
    ctx.cwd,
    ctx.hooks,
    ctx.addWatchFile,
  );
  const runtime = require("@utoo/pack") as Pick<
    typeof import("@utoo/pack"),
    "analyze" | "moduleReferencesVersion"
  >;
  assertUtoopackModuleReferenceSupport(runtime, config);
  return runtime.analyze({ config }, ctx.cwd, undefined, {
    outputPath: ctx.outputPath,
  });
}

export function serveBundleAnalysisReport(reportPath: string, port?: number) {
  const { serveAnalyzeReport } = require("@utoo/pack") as Pick<
    typeof import("@utoo/pack"),
    "serveAnalyzeReport"
  >;
  return serveAnalyzeReport(reportPath, port);
}

export function exportBundleAnalysisReport(
  reportPath: string,
  options?: AnalyzeExportOptions,
) {
  // The report-only subpath does not load the native compiler or project config.
  const { exportAnalyzeReport } =
    require("@utoo/pack/analyze") as typeof import("@utoo/pack/analyze");
  return exportAnalyzeReport(reportPath, options);
}
