import type { PageMetadata } from "@evjs/shared/manifest";
import type { HtmlDocument } from "../../../../plugin/index.js";

const PAGE_METADATA_ATTRIBUTE = "data-evjs-page-metadata";
const PAGE_METADATA_BASELINE_ATTRIBUTE = "data-evjs-page-metadata-baseline";
const PAGE_METADATA_CREATED_ATTRIBUTE = "data-evjs-page-metadata-created";

export interface ApplyPageMetadataOptions {
  /**
   * Preserve template values for an SPA runtime that may later activate
   * another Page in the same browser document.
   */
  preserveBaseline?: boolean;
}

/**
 * Apply Page-owned metadata to a parsed HTML template.
 *
 * Authored Page metadata overrides matching template defaults. Metadata names
 * use ASCII case-insensitive matching, mirroring HTML attribute semantics, and
 * duplicate matching template nodes are removed.
 */
export function applyPageMetadataToHtmlDocument(
  doc: HtmlDocument,
  metadata: PageMetadata | undefined,
  options: ApplyPageMetadataOptions = {},
): void {
  if (!metadata || !doc.head) return;

  if (metadata.title !== undefined) {
    upsertTitle(doc, metadata.title, options);
  }

  for (const [name, content] of Object.entries(metadata.meta ?? {})) {
    upsertNamedMeta(doc, name, content, options);
  }
}

function upsertTitle(
  doc: HtmlDocument,
  title: string,
  options: ApplyPageMetadataOptions,
): void {
  const titles = doc.querySelectorAll("title");
  const target = titles[0] ?? doc.createElement("title");
  if (options.preserveBaseline) {
    markMetadataNode(target, "title", titles.length === 0);
  }
  target.textContent = title;
  if (titles.length === 0) {
    doc.head?.appendChild(target);
  }
  for (const duplicate of titles.slice(1)) {
    duplicate.remove();
  }
}

function upsertNamedMeta(
  doc: HtmlDocument,
  name: string,
  content: string,
  options: ApplyPageMetadataOptions,
): void {
  const normalizedName = toAsciiLowerCase(name);
  const matches = doc
    .querySelectorAll("meta[name]")
    .filter(
      (element) =>
        toAsciiLowerCase(element.getAttribute("name") ?? "") === normalizedName,
    );
  const target = matches[0] ?? doc.createElement("meta");
  if (options.preserveBaseline) {
    markMetadataNode(target, "meta", matches.length === 0);
  }
  if (matches.length === 0) {
    target.setAttribute("name", name);
  }
  target.setAttribute("content", content);
  if (matches.length === 0) {
    doc.head?.appendChild(target);
  }
  for (const duplicate of matches.slice(1)) {
    duplicate.remove();
  }
}

function markMetadataNode(
  node: HtmlDocument,
  kind: "title" | "meta",
  created: boolean,
): void {
  if (node.getAttribute(PAGE_METADATA_ATTRIBUTE) === kind) return;

  node.setAttribute(PAGE_METADATA_ATTRIBUTE, kind);
  if (created) {
    node.setAttribute(PAGE_METADATA_CREATED_ATTRIBUTE, "");
    return;
  }

  const baseline =
    kind === "title" ? node.textContent : node.getAttribute("content");
  if (baseline !== null) {
    node.setAttribute(PAGE_METADATA_BASELINE_ATTRIBUTE, baseline);
  }
}

function toAsciiLowerCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) + 32),
  );
}
