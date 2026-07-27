import fs from "node:fs";
import path from "node:path";
import { createCsrExampleTest, expect } from "../fixtures";

const exampleDir = path.resolve(
  import.meta.dirname,
  "../..",
  "examples",
  "with-tailwind",
);

const test = createCsrExampleTest("with-tailwind");

test.describe("with-tailwind", () => {
  test("Tailwind CSS loaded via plugin is applied", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL);

    // Title should be visible
    const title = page.getByTestId("title");
    await expect(title).toBeVisible({ timeout: 10_000 });
    await expect(title).toHaveText("Tailwind Plugin Example");

    // Verify Tailwind text-5xl (font-size: 3rem = 48px) is applied
    const fontSize = await title.evaluate(
      (el) => getComputedStyle(el).fontSize,
    );
    expect(fontSize).toBe("48px");
  });

  test("deployment metadata contains the SPA document and assets", async ({
    baseURL,
  }) => {
    expect(baseURL).toMatch(/^http:\/\/localhost:\d+$/);

    const manifestPath = path.join(
      exampleDir,
      "dist",
      "deployment-metadata.json",
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    expect(manifest.assets.main.js.length).toBeGreaterThan(0);
    expect(manifest).not.toHaveProperty("pages");
    expect(manifest).not.toHaveProperty("runtime");
    expect(manifest.documents).toEqual([
      expect.objectContaining({
        kind: "app",
        id: "default",
        fileName: "index.html",
        fallback: "/",
      }),
    ]);
    expect(fs.existsSync(path.join(exampleDir, "dist", "manifest.json"))).toBe(
      false,
    );
  });
});
