import type { ComponentType, ExoticComponent } from "react";

export type ReactComponentExport<P = Record<string, unknown>> =
  | ComponentType<P>
  | ExoticComponent<P>;

export function isReactComponentExport<P = Record<string, unknown>>(
  value: unknown,
): value is ReactComponentExport<P> {
  if (typeof value === "function") return true;
  return isRecord(value) && typeof value.$$typeof === "symbol";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
