import { expect, it, vi } from "vitest";
import { exportBundleAnalysisReport } from "../src/analysis/index.js";

const packMock = vi.hoisted(() => {
  const exporterPath = "/mock/pack/commands/exportAnalyzeReport.js";
  const record = { type: "meta", schema_version: 1, selected_entries: 1 };
  const exportAnalyzeReport = vi.fn(async function* () {
    yield record;
  });
  const load = vi.fn((specifier: string) => {
    if (specifier !== exporterPath) {
      throw new Error(`Unexpected runtime import: ${specifier}`);
    }
    return { exportAnalyzeReport };
  });
  const resolve = vi.fn((specifier: string) => {
    if (specifier !== "@utoo/pack/analyze") {
      throw new Error(`Unexpected runtime resolution: ${specifier}`);
    }
    return exporterPath;
  });
  return { load, resolve, exportAnalyzeReport, record };
});

vi.mock("node:module", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:module")>()),
  createRequire: () =>
    Object.assign(packMock.load, { resolve: packMock.resolve }),
}));

it("streams a saved report through Pack's native-free export entry", async () => {
  const records = [];
  const filters = { entry: "main", environment: "client" } as const;
  for await (const record of exportBundleAnalysisReport(
    "reports/before",
    filters,
  )) {
    records.push(record);
  }
  expect(records).toEqual([packMock.record]);
  expect(packMock.exportAnalyzeReport).toHaveBeenCalledWith(
    "reports/before",
    filters,
  );
});
