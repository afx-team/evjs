/**
 * Utoopack bundler adapter for the evjs framework.
 *
 * Leverages @utoo/pack's native "use server" directive support
 * for zero-config server function handling.
 */

export type { UtoopackDevEditBatchOptions } from "./adapter/index.js";
export { createUtoopackAdapter, utoopackAdapter } from "./adapter/index.js";
export type { ConfigPatch } from "./plugin-helper.js";
export { merge, utoopack } from "./plugin-helper.js";
