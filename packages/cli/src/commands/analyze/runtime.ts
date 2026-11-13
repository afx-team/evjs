import type { BundleAnalysisActions } from "./command.js";

export const bundleAnalysisActions: BundleAnalysisActions = {
  async capture(config, options) {
    const [{ analyzeFrameworkBuild }, { utoopackAdapter }] = await Promise.all([
      import("@evjs/ev/_internal/build/analyze"),
      import("@evjs/bundler-utoopack"),
    ]);
    return analyzeFrameworkBuild(config, {
      ...options,
      bundler: config?.bundler ?? utoopackAdapter,
    });
  },

  async serveReport(reportPath, port) {
    const { serveBundleAnalysisReport } = await import(
      "@evjs/bundler-utoopack/_internal/analyze"
    );
    return serveBundleAnalysisReport(reportPath, port);
  },

  async *exportReport(reportPath, filters) {
    const { exportBundleAnalysisReport } = await import(
      "@evjs/bundler-utoopack/_internal/analyze"
    );
    yield* exportBundleAnalysisReport(reportPath, filters);
  },

  writeJsonLine(line) {
    const { stdout } = process;
    return new Promise<void>((resolve, reject) => {
      // Wait for the write callback so a large report does not accumulate in
      // stdout's buffer. A failed write also emits an error on the stream.
      const onError = (error: Error) => reject(error);
      stdout.once("error", onError);
      stdout.write(line, (error) => {
        if (error) {
          reject(error);
        } else {
          stdout.off("error", onError);
          resolve();
        }
      });
    });
  },
};
