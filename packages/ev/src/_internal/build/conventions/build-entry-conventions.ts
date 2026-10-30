export const GENERATED_PAGES_APP_BUILD_ENTRY =
  "@evjs/ev/_internal/generated/pages-app";
export const SERVER_RUNTIME_BUILD_ENTRY_NAME = "server";

export function createApplicationClientBuildEntryName(appId: string): string {
  return appId === "default"
    ? "main"
    : `app-client-${encodeBuildEntryOwner(appId)}`;
}

export function createPageClientBuildEntryName(pageId: string): string {
  return `page-client-${encodeBuildEntryOwner(pageId)}`;
}

export function createPageServerBuildEntryName(pageId: string): string {
  return `page-server-${encodeBuildEntryOwner(pageId)}`;
}

export function createRscPageBuildEntryName(pageId: string): string {
  return `rsc-page-${encodeBuildEntryOwner(pageId)}`;
}

export function createPprShellBuildEntryName(pageId: string): string {
  return `ppr-shell-${encodeBuildEntryOwner(pageId)}`;
}

export function createPprRegionBuildEntryName(
  pageId: string,
  regionId: string,
): string {
  return `ppr-region-${encodeBuildEntryOwner(pageId)}-${encodeBuildEntryOwner(regionId)}`;
}

/**
 * Keep generated entry names inside the shared build-identifier alphabet while
 * preserving an injective mapping from arbitrary Core owner ids.
 */
function encodeBuildEntryOwner(value: string): string {
  let encoded = "";
  for (const byte of new TextEncoder().encode(value)) {
    const character = String.fromCharCode(byte);
    if (/^[a-zA-Z0-9]$/.test(character)) {
      encoded += character;
    } else if (character === "_") {
      encoded += "__";
    } else {
      encoded += `_${byte.toString(16).padStart(2, "0")}`;
    }
  }
  return encoded;
}
