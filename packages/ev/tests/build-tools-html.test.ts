import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateHtml } from "../src/_internal/build/output/html/html.js";
import { applyPageMetadataToHtmlDocument } from "../src/_internal/build/output/html/page-metadata-html.js";

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

  it("preserves explicit asset URLs and applies publicPath only to relatives", () => {
    const doc = generateHtml({
      template: TEMPLATE_PATH,
      publicPath: "/static/",
      js: [
        "main.js?v=1#boot",
        "https://cdn.example.com/vendor.js",
        "data:text/javascript,export%20default%201",
      ],
      css: ["theme.css", "//cdn.example.com/reset.css"],
    });
    const result = doc.toString();

    expect(result).toContain('src="/static/main.js?v=1#boot"');
    expect(result).toContain('src="https://cdn.example.com/vendor.js"');
    expect(result).toContain('src="data:text/javascript,export%20default%201"');
    expect(result).toContain('href="/static/theme.css"');
    expect(result).toContain('href="//cdn.example.com/reset.css"');
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

  it("upserts Page metadata over template defaults without duplicate names", () => {
    fs.writeFileSync(
      TEMPLATE_PATH,
      `<!DOCTYPE html>
      <html>
        <head>
          <title>Template title</title>
          <title>Duplicate title</title>
          <meta name="Description" content="template">
          <meta name="description" content="duplicate">
          <meta name="viewport" content="width=device-width">
        </head>
        <body><div id="app"></div></body>
      </html>`,
    );
    const doc = generateHtml({ template: TEMPLATE_PATH, js: [], css: [] });

    applyPageMetadataToHtmlDocument(doc, {
      title: "Configured <title>",
      meta: {
        description: 'Configured "description"',
        "theme-color": "#fff",
      },
    });

    expect(doc.querySelectorAll("title")).toHaveLength(1);
    expect(doc.querySelector("title")?.textContent).toBe("Configured <title>");
    const descriptions = doc
      .querySelectorAll("meta[name]")
      .filter(
        (meta) => meta.getAttribute("name")?.toLowerCase() === "description",
      );
    expect(descriptions).toHaveLength(1);
    expect(descriptions[0]?.getAttribute("name")).toBe("Description");
    expect(descriptions[0]?.getAttribute("content")).toBe(
      'Configured "description"',
    );
    expect(
      doc.querySelector('meta[name="viewport"]')?.getAttribute("content"),
    ).toBe("width=device-width");
    expect(
      doc.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
    ).toBe("#fff");
  });

  it("preserves template metadata omitted by the Page", () => {
    const doc = generateHtml({ template: TEMPLATE_PATH, js: [], css: [] });

    applyPageMetadataToHtmlDocument(doc, {
      meta: { description: "Page description" },
    });

    expect(doc.querySelector("title")?.textContent).toBe("Test App");
    expect(
      doc.querySelector('meta[name="viewport"]')?.getAttribute("content"),
    ).toBe("width=device-width, initial-scale=1.0");
  });

  it("records SPA template baselines without overwriting them on a second upsert", () => {
    const doc = generateHtml({ template: TEMPLATE_PATH, js: [], css: [] });
    const robots = doc.createElement("meta");
    robots.setAttribute("name", "robots");
    doc.head?.appendChild(robots);

    applyPageMetadataToHtmlDocument(
      doc,
      {
        title: "First Page",
        meta: {
          viewport: "first",
          description: "created",
          robots: "index",
        },
      },
      { preserveBaseline: true },
    );
    applyPageMetadataToHtmlDocument(
      doc,
      {
        title: "Second Page",
        meta: {
          VIEWPORT: "second",
          DESCRIPTION: "updated",
          ROBOTS: "noindex",
        },
      },
      { preserveBaseline: true },
    );

    const title = doc.querySelector("title");
    expect(title?.getAttribute("data-evjs-page-metadata")).toBe("title");
    expect(title?.getAttribute("data-evjs-page-metadata-baseline")).toBe(
      "Test App",
    );
    expect(title?.hasAttribute("data-evjs-page-metadata-created")).toBe(false);

    const viewport = doc.querySelector('meta[name="viewport"]');
    expect(viewport?.getAttribute("data-evjs-page-metadata")).toBe("meta");
    expect(viewport?.getAttribute("data-evjs-page-metadata-baseline")).toBe(
      "width=device-width, initial-scale=1.0",
    );
    expect(viewport?.getAttribute("content")).toBe("second");

    expect(robots.getAttribute("data-evjs-page-metadata")).toBe("meta");
    expect(robots.hasAttribute("data-evjs-page-metadata-baseline")).toBe(false);
    expect(robots.hasAttribute("data-evjs-page-metadata-created")).toBe(false);
    expect(robots.getAttribute("content")).toBe("noindex");

    const descriptions = doc
      .querySelectorAll("meta[name]")
      .filter(
        (meta) => meta.getAttribute("name")?.toLowerCase() === "description",
      );
    expect(descriptions).toHaveLength(1);
    expect(descriptions[0]?.getAttribute("data-evjs-page-metadata")).toBe(
      "meta",
    );
    expect(
      descriptions[0]?.getAttribute("data-evjs-page-metadata-created"),
    ).toBe("");
    expect(
      descriptions[0]?.hasAttribute("data-evjs-page-metadata-baseline"),
    ).toBe(false);
    expect(descriptions[0]?.getAttribute("content")).toBe("updated");
  });
});
