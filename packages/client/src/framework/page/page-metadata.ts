import type { PageMetadata } from "@evjs/shared/manifest";

const PAGE_METADATA_ATTRIBUTE = "data-evjs-page-metadata";
const PAGE_METADATA_BASELINE_ATTRIBUTE = "data-evjs-page-metadata-baseline";
const PAGE_METADATA_CREATED_ATTRIBUTE = "data-evjs-page-metadata-created";

interface PageMetadataController {
  apply(metadata: PageMetadata | undefined): void;
  restore(): void;
}

interface TitleBaseline {
  element?: HTMLTitleElement;
  existed: boolean;
  text: string;
}

interface MetaBaseline {
  element?: HTMLMetaElement;
  existed: boolean;
  hadContent: boolean;
  content?: string;
  name: string;
}

/** Manage the document fields declared by generated Page routes. */
export function createPageMetadataController(
  definitions: readonly (PageMetadata | undefined)[],
  resolveDocument: () => Document | undefined = getBrowserDocument,
): PageMetadataController {
  const managesTitle = definitions.some(
    (metadata) => metadata?.title !== undefined,
  );
  const managedMetaNames = collectManagedMetaNames(definitions);
  let activeDocument: Document | undefined;
  let titleBaseline: TitleBaseline | undefined;
  let metaBaselines: Map<string, MetaBaseline> | undefined;

  function capture(document: Document): void {
    const head = document.head;
    if (!head) return;
    activeDocument = document;
    titleBaseline = managesTitle ? captureTitleBaseline(head) : undefined;
    metaBaselines = new Map(
      [...managedMetaNames.entries()].map(([identity, name]) => [
        identity,
        captureMetaBaseline(head, name),
      ]),
    );
  }

  function restore(): void {
    const head = activeDocument?.head;
    if (!head) return;
    if (titleBaseline) restoreTitleBaseline(head, titleBaseline);
    for (const baseline of metaBaselines?.values() ?? []) {
      restoreMetaBaseline(head, baseline);
    }
  }

  return {
    apply(metadata) {
      const document = resolveDocument();
      if (!document?.head) return;
      if (activeDocument !== document || !metaBaselines) {
        if (activeDocument && activeDocument !== document) restore();
        capture(document);
      }
      restore();
      if (metadata?.title !== undefined && titleBaseline) {
        const element = getOrCreateTitleElement(document.head, titleBaseline);
        element.textContent = metadata.title;
      }
      const currentMeta = normalizeMetaValues(metadata?.meta);
      for (const [identity, baseline] of metaBaselines?.entries() ?? []) {
        const current = currentMeta.get(identity);
        if (!current) continue;
        const element = getOrCreateMetaElement(document.head, baseline);
        if (!baseline.existed) element.setAttribute("name", current.name);
        element.setAttribute("content", current.content);
      }
    },
    restore,
  };
}

function collectManagedMetaNames(
  definitions: readonly (PageMetadata | undefined)[],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const metadata of definitions) {
    for (const name of Object.keys(metadata?.meta ?? {})) {
      const identity = normalizeMetaName(name);
      if (!names.has(identity)) names.set(identity, name);
    }
  }
  return names;
}

function normalizeMetaValues(
  meta: Readonly<Record<string, string>> | undefined,
): Map<string, { name: string; content: string }> {
  return new Map(
    Object.entries(meta ?? {}).map(([name, content]) => [
      normalizeMetaName(name),
      { name, content },
    ]),
  );
}

function captureTitleBaseline(head: HTMLHeadElement): TitleBaseline {
  const titles = [...head.querySelectorAll<HTMLTitleElement>("title")];
  const element = titles[0];
  if (!element) return { existed: false, text: "" };
  for (const duplicate of titles.slice(1)) {
    duplicate.remove();
  }
  const frameworkManaged =
    element.getAttribute(PAGE_METADATA_ATTRIBUTE) === "title";
  const created =
    frameworkManaged && element.hasAttribute(PAGE_METADATA_CREATED_ATTRIBUTE);
  const text =
    frameworkManaged && element.hasAttribute(PAGE_METADATA_BASELINE_ATTRIBUTE)
      ? (element.getAttribute(PAGE_METADATA_BASELINE_ATTRIBUTE) ?? "")
      : (element.textContent ?? "");
  clearPageMetadataAttributes(element);
  return {
    element,
    existed: !created,
    text,
  };
}

function captureMetaBaseline(
  head: HTMLHeadElement,
  name: string,
): MetaBaseline {
  const elements = findNamedMetaElements(head, name);
  const element = elements[0];
  if (!element) {
    return {
      existed: false,
      hadContent: false,
      name,
    };
  }
  for (const duplicate of elements.slice(1)) {
    duplicate.remove();
  }
  const frameworkManaged =
    element.getAttribute(PAGE_METADATA_ATTRIBUTE) === "meta";
  const created =
    frameworkManaged && element.hasAttribute(PAGE_METADATA_CREATED_ATTRIBUTE);
  const hasBaseline =
    frameworkManaged && element.hasAttribute(PAGE_METADATA_BASELINE_ATTRIBUTE);
  const hadContent = frameworkManaged
    ? hasBaseline
    : element.hasAttribute("content");
  let content: string | undefined;
  if (frameworkManaged && hasBaseline) {
    content = element.getAttribute(PAGE_METADATA_BASELINE_ATTRIBUTE) ?? "";
  } else if (!frameworkManaged) {
    content = element.getAttribute("content") ?? undefined;
  }
  clearPageMetadataAttributes(element);
  return {
    element,
    existed: !created,
    hadContent,
    ...(content !== undefined ? { content } : {}),
    name: element.getAttribute("name") ?? name,
  };
}

function restoreTitleBaseline(
  head: HTMLHeadElement,
  baseline: TitleBaseline,
): void {
  if (!baseline.existed) {
    baseline.element?.remove();
    baseline.element = undefined;
    return;
  }
  const element = getOrCreateTitleElement(head, baseline);
  element.textContent = baseline.text;
}

function restoreMetaBaseline(
  head: HTMLHeadElement,
  baseline: MetaBaseline,
): void {
  if (!baseline.existed) {
    baseline.element?.remove();
    baseline.element = undefined;
    return;
  }
  const element = getOrCreateMetaElement(head, baseline);
  if (baseline.hadContent) {
    element.setAttribute("content", baseline.content ?? "");
  } else {
    element.removeAttribute("content");
  }
}

function getOrCreateTitleElement(
  head: HTMLHeadElement,
  baseline: TitleBaseline,
): HTMLTitleElement {
  if (baseline.element && head.contains(baseline.element)) {
    return baseline.element;
  }
  const element = head.ownerDocument.createElement("title");
  head.append(element);
  baseline.element = element;
  return element;
}

function getOrCreateMetaElement(
  head: HTMLHeadElement,
  baseline: MetaBaseline,
): HTMLMetaElement {
  if (baseline.element && head.contains(baseline.element)) {
    return baseline.element;
  }
  const element = head.ownerDocument.createElement("meta");
  element.setAttribute("name", baseline.name);
  head.append(element);
  baseline.element = element;
  return element;
}

function findNamedMetaElements(
  head: HTMLHeadElement,
  name: string,
): HTMLMetaElement[] {
  const identity = normalizeMetaName(name);
  return [...head.querySelectorAll<HTMLMetaElement>("meta[name]")].filter(
    (element) =>
      normalizeMetaName(element.getAttribute("name") ?? "") === identity,
  );
}

function normalizeMetaName(name: string): string {
  return name.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function clearPageMetadataAttributes(element: Element): void {
  element.removeAttribute(PAGE_METADATA_ATTRIBUTE);
  element.removeAttribute(PAGE_METADATA_BASELINE_ATTRIBUTE);
  element.removeAttribute(PAGE_METADATA_CREATED_ATTRIBUTE);
}

function getBrowserDocument(): Document | undefined {
  return typeof document === "undefined" ? undefined : document;
}
