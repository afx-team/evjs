import type { ComponentType, ExoticComponent } from "react";
import { isRecord } from "./validation.js";

export type ReactComponentExport<P = Record<string, unknown>> =
  | ComponentType<P>
  | ExoticComponent<P>;

export function isReactComponentExport<P = Record<string, unknown>>(
  value: unknown,
): value is ReactComponentExport<P> {
  if (typeof value === "function") return true;
  return isRecord(value) && typeof value.$$typeof === "symbol";
}
