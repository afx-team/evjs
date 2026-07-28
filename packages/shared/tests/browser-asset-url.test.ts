import { describe, expect, it } from "vitest";
import { resolveBrowserAssetHref } from "../src/browser-asset-url.js";

describe("resolveBrowserAssetHref", () => {
  it.each([
    "https://cdn.example.com/app.js",
    "data:text/javascript,export%20default%201",
    "blob:https://example.com/id",
    "//cdn.example.com/app.css",
    "/assets/app.css?v=1",
  ])("preserves explicit browser URL %s", (asset) => {
    expect(resolveBrowserAssetHref(asset, "/static/")).toBe(asset);
  });

  it("projects relative assets through the configured public path", () => {
    expect(resolveBrowserAssetHref("main.js", "auto")).toBe("/main.js");
    expect(resolveBrowserAssetHref("main.js", "/assets")).toBe(
      "/assets/main.js",
    );
    expect(
      resolveBrowserAssetHref("main.js", "https://cdn.example.com/assets/"),
    ).toBe("https://cdn.example.com/assets/main.js");
  });
});
