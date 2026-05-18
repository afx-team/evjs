/**
 * Document request helpers shared by server runtime and tests.
 */

const DOCUMENT_METHODS = new Set(["GET", "HEAD"]);

const ASSET_EXTENSION_RE =
  /\.(?:avif|css|gif|ico|jpe?g|js|json|map|mjs|otf|png|svg|ttf|txt|wasm|webp|woff2?|xml)$/i;

export function acceptsDocument(accept: string | null | undefined): boolean {
  if (!accept) return true;
  return accept.includes("text/html") || accept.includes("*/*");
}

export function isKnownAssetPath(pathname: string): boolean {
  const lastSegment = pathname.split("/").at(-1) ?? "";
  return ASSET_EXTENSION_RE.test(lastSegment);
}

export function isDocumentRequestLike(options: {
  method: string;
  accept?: string | null;
  pathname: string;
}): boolean {
  return (
    DOCUMENT_METHODS.has(options.method) &&
    acceptsDocument(options.accept) &&
    !isKnownAssetPath(options.pathname)
  );
}
