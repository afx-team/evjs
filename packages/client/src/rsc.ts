import { createElement, type ReactNode, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { fetchRscFlight, type RscFlightFetchOptions } from "./react.js";

export interface ReactRscModelOptions extends RscFlightFetchOptions {
  moduleBaseURL?: string;
}

export interface ReactRscMountOptions extends ReactRscModelOptions {
  mount: string | Element;
  fallback?: ReactNode;
}

const rootByMountPoint = new WeakMap<Element, Root>();

export async function createReactRscModel(
  options: ReactRscModelOptions,
): Promise<ReactNode> {
  const { createFromFetch } = await import("react-server-dom-webpack/client");
  return createFromFetch(fetchRscFlight(options), {
    moduleBaseURL: options.moduleBaseURL,
  }) as ReactNode;
}

export async function mountReactRscPage(
  options: ReactRscMountOptions,
): Promise<ReactNode> {
  const mountPoint = resolveMountPoint(options.mount);
  const model = await createReactRscModel(options);
  const root = createRoot(mountPoint);
  root.render(
    createElement(Suspense, { fallback: options.fallback ?? null }, model),
  );
  rootByMountPoint.set(mountPoint, root);
  return model;
}

export function unmountReactRscPage(mount: string | Element): void {
  const mountPoint = resolveMountPoint(mount);
  rootByMountPoint.get(mountPoint)?.unmount();
  rootByMountPoint.delete(mountPoint);
}

function resolveMountPoint(mount: string | Element): Element {
  if (typeof mount !== "string") return mount;
  const mountPoint = document.querySelector(mount);
  if (!mountPoint) {
    throw new Error(`[evjs] Mount point "${mount}" was not found.`);
  }
  return mountPoint;
}
