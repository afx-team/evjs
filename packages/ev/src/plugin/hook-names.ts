export const PLUGIN_HOOK_NAMES = [
  "buildStart",
  "buildOutput",
  "bundlerConfig",
  "buildEnd",
  "dispose",
  "transformHtml",
] as const;

export const LEGACY_PLUGIN_HOOK_REPLACEMENTS = new Map<string, string>([
  ["modifyHTML", "transformHtml"],
  ["modifyHTMLViaAST", "transformHtml"],
  ["modifyBundlerConfig", "bundlerConfig"],
  ["onBuildStart", "buildStart"],
  ["onBuildEnd", "buildEnd"],
  ["onBuildComplete", "buildEnd"],
]);

/**
 * Plugin descriptor objects are open to package-local metadata, but lifecycle
 * hooks belong to setup(). Reserve both current and historical hook spellings
 * so misplaced hooks fail instead of becoming ignored metadata.
 */
export function isPluginLifecycleDescriptorField(value: string): boolean {
  if ((PLUGIN_HOOK_NAMES as readonly string[]).includes(value)) return true;
  if (LEGACY_PLUGIN_HOOK_REPLACEMENTS.has(value)) return true;

  const normalized = value.toLowerCase();
  return (
    PLUGIN_HOOK_NAMES.some((name) => name.toLowerCase() === normalized) ||
    [...LEGACY_PLUGIN_HOOK_REPLACEMENTS.keys()].some(
      (name) => name.toLowerCase() === normalized,
    )
  );
}
