export const PLUGIN_HOOK_NAMES = [
  "configureBundler",
  "clientDevMiddleware",
  "devServerReady",
  "beforeBuild",
  "transformOutput",
  "transformHtml",
  "afterBuild",
  "dispose",
] as const;

/**
 * Lifecycle hooks belong to setup(). Reserve current hook spellings, including
 * casing mistakes, so misplaced hooks fail instead of becoming ignored fields.
 */
export function isPluginLifecycleDescriptorField(value: string): boolean {
  if ((PLUGIN_HOOK_NAMES as readonly string[]).includes(value)) return true;

  const normalized = value.toLowerCase();
  return PLUGIN_HOOK_NAMES.some((name) => name.toLowerCase() === normalized);
}
