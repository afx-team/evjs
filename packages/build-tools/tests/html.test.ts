import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateHtml } from "../src/html.js";

const FIXTURES_DIR = path.join(import.meta.dirname, "__fixtures__");
const TEMPLATE_PATH = path.join(FIXTURES_DIR, "template.html");

const TEMPLATE_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Test App</title>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
`;

describe("generateHtml", () => {
  beforeEach(() => {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    fs.writeFileSync(TEMPLATE_PATH, TEMPLATE_HTML);
  });

  afterEach(() => {
    fs.rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });

  it("injects JS script tags into <body>", () => {
    const doc = generateHtml({
      template: TEMPLATE_PATH,
      js: ["main.abc12345.js"],
      css: [],
    });
    const result = doc.toString();

    // Parser serializes boolean `defer` as `defer=""`
    expect(result).toContain('src="/main.abc12345.js"');
    expect(result).toContain("defer");
    expect(result).toContain("</body>");
  });

  it("injects CSS link tags into <head>", () => {
    const doc = generateHtml({
      template: TEMPLATE_PATH,
      js: [],
      css: ["main.abc12345.css"],
    });
    const result = doc.toString();

    expect(result).toContain(
      '<link rel="stylesheet" href="/main.abc12345.css">',
    );
    expect(result).toContain("</head>");
  });

  it("injects both JS and CSS assets", () => {
    const doc = generateHtml({
      template: TEMPLATE_PATH,
      js: ["main.abc12345.js", "vendor.def67890.js"],
      css: ["main.abc12345.css"],
    });
    const result = doc.toString();

    expect(result).toContain('src="/main.abc12345.js"');
    expect(result).toContain('src="/vendor.def67890.js"');
    expect(result).toContain('href="/main.abc12345.css"');
  });

  it("preserves original template content", () => {
    const doc = generateHtml({
      template: TEMPLATE_PATH,
      js: ["main.js"],
      css: [],
    });
    const result = doc.toString();

    expect(result).toContain('<div id="app">');
    expect(result).toContain("<title>Test App</title>");
    expect(result).toContain('charset="UTF-8"');
  });

  it("handles empty asset lists", () => {
    const doc = generateHtml({
      template: TEMPLATE_PATH,
      js: [],
      css: [],
    });
    const result = doc.toString();

    expect(result).not.toContain("<script");
    expect(result).not.toContain("<link");
    expect(result).toContain('<div id="app">');
  });

  it("respects custom publicPath", () => {
    const doc = generateHtml({
      template: TEMPLATE_PATH,
      js: ["main.js"],
      css: ["main.css"],
      publicPath: "/static/",
    });
    const result = doc.toString();

    expect(result).toContain('src="/static/main.js"');
    expect(result).toContain('href="/static/main.css"');
  });

  it("injects assets in correct order", () => {
    const doc = generateHtml({
      template: TEMPLATE_PATH,
      js: ["first.js", "second.js"],
      css: ["a.css", "b.css"],
    });
    const result = doc.toString();

    const firstJsIdx = result.indexOf("first.js");
    const secondJsIdx = result.indexOf("second.js");
    expect(firstJsIdx).toBeLessThan(secondJsIdx);

    const aCssIdx = result.indexOf("a.css");
    const bCssIdx = result.indexOf("b.css");
    expect(aCssIdx).toBeLessThan(bCssIdx);
  });

  it("produces valid HTML with doctype", () => {
    const doc = generateHtml({
      template: TEMPLATE_PATH,
      js: ["main.js"],
      css: [],
    });
    const result = doc.toString();

    expect(result).toMatch(/^<!DOCTYPE html>/i);
    expect(result).toContain("<html");
    expect(result).toContain("</html>");
  });

  it("supports JS assets with custom attributes", () => {
    const doc = generateHtml({
      template: TEMPLATE_PATH,
      js: [
        {
          url: "main.js",
          attrs: { crossorigin: "anonymous", integrity: "sha384-abc123" },
        },
      ],
      css: [],
    });
    const result = doc.toString();

    expect(result).toContain('crossorigin="anonymous"');
    expect(result).toContain('integrity="sha384-abc123"');
    expect(result).toContain('src="/main.js"');
  });

  it("supports CSS assets with custom attributes", () => {
    const doc = generateHtml({
      template: TEMPLATE_PATH,
      js: [],
      css: [
        {
          url: "main.css",
          attrs: { media: "print", crossorigin: "anonymous" },
        },
      ],
    });
    const result = doc.toString();

    expect(result).toContain('media="print"');
    expect(result).toContain('crossorigin="anonymous"');
    expect(result).toContain('href="/main.css"');
  });

  it("uses async instead of defer when specified", () => {
    const doc = generateHtml({
      template: TEMPLATE_PATH,
      js: [{ url: "analytics.js", attrs: { async: true } }],
      css: [],
    });
    const result = doc.toString();

    expect(result).toContain("async");
    // Should NOT have defer when async is explicitly set
    expect(result).not.toMatch(/defer.*analytics\.js/);
    expect(result).toContain('src="/analytics.js"');
  });

  it("mixes plain string and object assets", () => {
    const doc = generateHtml({
      template: TEMPLATE_PATH,
      js: [
        "vendor.js",
        { url: "main.js", attrs: { crossorigin: "anonymous" } },
      ],
      css: [
        "reset.css",
        { url: "theme.css", attrs: { media: "(prefers-color-scheme: dark)" } },
      ],
    });
    const result = doc.toString();

    expect(result).toContain('src="/vendor.js"');
    expect(result).toContain('src="/main.js"');
    expect(result).toContain('crossorigin="anonymous"');
    expect(result).toContain('href="/reset.css"');
    expect(result).toContain('href="/theme.css"');
    expect(result).toContain("prefers-color-scheme");
  });

  it("returns a DOM document that supports mutation", () => {
    const doc = generateHtml({
      template: TEMPLATE_PATH,
      js: ["main.js"],
      css: [],
    });

    // Plugins should be able to mutate the document
    const comment = doc.createComment(" injected by plugin ");
    doc.head?.appendChild(comment);

    const result = doc.toString();
    expect(result).toContain("<!-- injected by plugin -->");
  });
});
