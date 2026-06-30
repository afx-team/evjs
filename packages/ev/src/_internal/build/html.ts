import fs from "node:fs";
import { DOMParser } from "domparser-rs";
import type { HtmlDocument } from "../../plugin/index.js";

/**
 * A single asset descriptor — either a plain filename string or an object
 * with a `url` and arbitrary HTML attributes.
 *
 * @example
 * // Plain string
 * "main.abc12345.js"
 *
 * // With attributes
 * { url: "main.abc12345.js", attrs: { crossorigin: "anonymous", integrity: "sha384-..." } }
 */
export type HtmlAsset =
  | string
  | { url: string; attrs?: Record<string, string | boolean> };

/**
 * Options for generating the final HTML output.
 */
export interface GenerateHtmlOptions {
  /** Absolute or relative path to the user's HTML template file. */
  template: string;
  /** JS assets to inject. */
  js: HtmlAsset[];
  /** CSS assets to inject. */
  css: HtmlAsset[];
}

const parser = new DOMParser();

export interface ValidateHtmlTemplateOptions {
  /** Absolute or relative path to the user's HTML template file. */
  template: string;
  /** Optional path displayed in diagnostics. Defaults to `template`. */
  displayName?: string;
}

interface ParsedHtmlTemplate {
  doc: HtmlDocument;
  head: HtmlDocument;
  body: HtmlDocument;
}

/** Escape a string for safe use in an HTML attribute value. */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Serialize an attributes record into an HTML attribute string. */
function renderAttrs(attrs: Record<string, string | boolean>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (value === true) {
      parts.push(key);
    } else if (value !== false) {
      parts.push(`${key}="${escapeAttr(value)}"`);
    }
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

/** Normalise a HtmlAsset into url + attrs. */
function normalizeAsset(asset: HtmlAsset): {
  url: string;
  attrs: Record<string, string | boolean>;
} {
  if (typeof asset === "string") {
    return { url: asset, attrs: {} };
  }
  return { url: asset.url, attrs: asset.attrs ?? {} };
}

/**
 * Parse the user's HTML template and inject bundled asset tags.
 *
 * - CSS `<link>` tags are appended to `<head>`.
 * - JS `<script>` tags are appended to `<body>` (with `defer`).
 *
 * Returns the parsed DOM document. Call `doc.toString()` to serialize.
 */
export function generateHtml(options: GenerateHtmlOptions): HtmlDocument {
  const { template, js, css } = options;

  const { body, doc, head } = parseHtmlTemplate({ template });

  // Inject CSS <link> tags into <head>
  for (const cssAsset of css) {
    const { url, attrs } = normalizeAsset(cssAsset);
    const href = escapeAttr(url.startsWith("/") ? url : `/${url}`);
    head.insertAdjacentHTML(
      "beforeend",
      `<link rel="stylesheet" href="${href}"${renderAttrs(attrs)}>`,
    );
  }

  // Inject JS <script defer> tags into <body>
  for (const jsAsset of js) {
    const { url, attrs } = normalizeAsset(jsAsset);
    const src = escapeAttr(url.startsWith("/") ? url : `/${url}`);
    // defer is default; user can override via attrs (e.g. { defer: false, async: true })
    const hasLoadStrategy = "async" in attrs || "defer" in attrs;
    const defaultAttrs = hasLoadStrategy ? "" : " defer";
    body.insertAdjacentHTML(
      "beforeend",
      `<script${defaultAttrs} src="${src}"${renderAttrs(attrs)}></script>`,
    );
  }

  return doc;
}

export function validateHtmlTemplate(
  options: ValidateHtmlTemplateOptions,
): HtmlDocument {
  return parseHtmlTemplate(options).doc;
}

function parseHtmlTemplate({
  template,
  displayName = template,
}: ValidateHtmlTemplateOptions): ParsedHtmlTemplate {
  const templateContent = fs.readFileSync(template, "utf-8");
  const doc = parser.parseFromString(
    templateContent,
    "text/html",
  ) as unknown as HtmlDocument;
  const head = doc.querySelector("head");
  const body = doc.querySelector("body");

  if (!head) {
    throw new Error(
      `[evjs] HTML template "${displayName}" is missing a <head> element.`,
    );
  }
  if (!body) {
    throw new Error(
      `[evjs] HTML template "${displayName}" is missing a <body> element.`,
    );
  }

  return { body, doc, head };
}
