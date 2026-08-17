import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectProjectSourceResolutionWatchDirectories,
  registerProjectSourceResolutionCandidates,
  type SourceDependencyReporter,
} from "../src/_internal/build/graph/source-resolution.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "evjs-source-resolution-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

describe("source resolution dependencies", () => {
  it("keeps candidate-by-candidate reporting for basic collectors", async () => {
    const cwd = await createTemporaryDirectory();
    const base = path.join(cwd, "src", "feature");
    const report = vi.fn();

    const candidates = registerProjectSourceResolutionCandidates(
      cwd,
      base,
      report,
    );

    expect(report.mock.calls.map(([candidate]) => candidate)).toEqual(
      candidates,
    );
  });

  it("reports one ordered resolver probe to capable collectors", async () => {
    const cwd = await createTemporaryDirectory();
    const base = path.join(cwd, "src", "feature");
    const resolutionCandidates = vi.fn();
    const report = Object.assign(vi.fn(), {
      resolutionCandidates,
    }) as SourceDependencyReporter;

    const candidates = registerProjectSourceResolutionCandidates(
      cwd,
      base,
      report,
    );

    expect(report).not.toHaveBeenCalled();
    expect(resolutionCandidates).toHaveBeenCalledOnce();
    expect(resolutionCandidates).toHaveBeenCalledWith(candidates);
  });

  it("watches the direct parent and only existing index directories", async () => {
    const cwd = await createTemporaryDirectory();
    const source = path.join(cwd, "src");
    const base = path.join(source, "feature");
    await fs.mkdir(source, { recursive: true });
    const missingCandidates = registerProjectSourceResolutionCandidates(
      cwd,
      base,
    );

    expect(
      collectProjectSourceResolutionWatchDirectories(missingCandidates),
    ).toEqual([source]);

    await fs.mkdir(base);
    expect(
      collectProjectSourceResolutionWatchDirectories(missingCandidates),
    ).toEqual([source, base].sort());
  });
});
