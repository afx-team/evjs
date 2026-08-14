import type { ClientTarget } from "../../config/index.js";

/** Lowest browser versions accepted by the compatibility target. */
export const CLIENT_TARGET_MINIMUM = {
  android: 5,
  ios: 8,
} as const;

/** Convert a normalized client target to the shared Browserslist expression. */
export function createClientBrowserslistTarget(target: ClientTarget): string {
  return `android >= ${target.android}, ios >= ${target.ios}`;
}
