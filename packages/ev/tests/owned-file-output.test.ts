import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyOwnedOutputFileTransaction } from "../src/_internal/build/owned-file-output.js";

describe("owned file output transactions", () => {
  it("restores prior files when a later mutation fails", async () => {
    const rootDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "evjs-owned-output-"),
    );
    const previousFile = path.join(rootDir, "previous.txt");
    const removedFile = path.join(rootDir, "runtime-manifest.json");
    const conflictingParent = path.join(rootDir, "conflict");
    await Promise.all([
      fs.promises.writeFile(previousFile, "previous", "utf-8"),
      fs.promises.writeFile(removedFile, "runtime", "utf-8"),
    ]);

    try {
      await expect(
        applyOwnedOutputFileTransaction(rootDir, [
          {
            type: "remove",
            filePath: removedFile,
            field: "runtime manifest",
          },
          {
            type: "write",
            filePath: previousFile,
            contents: "changed",
            field: "previous output",
          },
          {
            type: "write",
            filePath: conflictingParent,
            contents: "blocking file",
            field: "blocking output",
          },
          {
            type: "write",
            filePath: path.join(conflictingParent, "nested.txt"),
            contents: "nested",
            field: "nested output",
          },
        ]),
      ).rejects.toThrow(
        "nested output must not traverse symbolic links or non-directory output ancestors",
      );

      await expect(fs.promises.readFile(previousFile, "utf-8")).resolves.toBe(
        "previous",
      );
      await expect(fs.promises.readFile(removedFile, "utf-8")).resolves.toBe(
        "runtime",
      );
      await expect(fs.promises.access(conflictingParent)).rejects.toThrow();
    } finally {
      await fs.promises.rm(rootDir, { recursive: true, force: true });
    }
  });
});
