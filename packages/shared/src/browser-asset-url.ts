const EXPLICIT_URL_SCHEME = /^[A-Za-z][A-Za-z\d+.-]*:/u;

/** Resolve one browser asset reference without corrupting explicit URLs. */
export function resolveBrowserAssetHref(
  asset: string,
  publicPath: string = "auto",
): string {
  if (
    asset.startsWith("/") ||
    asset.startsWith("//") ||
    EXPLICIT_URL_SCHEME.test(asset)
  ) {
    return asset;
  }
  if (publicPath === "auto") return `/${asset}`;
  const base = publicPath.endsWith("/") ? publicPath : `${publicPath}/`;
  return `${base}${asset}`;
}
