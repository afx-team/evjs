import { describe, expect, it } from "vitest";
import * as client from "../src/index";
import {
  usePageContext,
  usePageLoaderData,
  usePageParams,
  usePageSearch,
} from "../src/index";
import { createPagesApp } from "../src/internal";

describe("page route hooks", () => {
  it("exports framework-managed route data hooks", () => {
    expect(usePageContext).toBeTypeOf("function");
    expect(usePageParams).toBeTypeOf("function");
    expect(usePageSearch).toBeTypeOf("function");
    expect(usePageLoaderData).toBeTypeOf("function");
  });

  it("does not expose generated SPA bootstrap APIs from the public client entry", () => {
    expect("createApp" in client).toBe(false);
    expect("createPagesApp" in client).toBe(false);
    expect("PageProvider" in client).toBe(false);
    expect("startPageRuntime" in client).toBe(false);
    expect("createReactPageModule" in client).toBe(false);
    expect("mountReactPage" in client).toBe(false);
    expect("createRemoteReactModule" in client).toBe(false);
    expect("createShell" in client).toBe(false);
    expect("createPageDriver" in client).toBe(false);
    expect("createHistoryDriver" in client).toBe(false);
    expect("registerSharedDependency" in client).toBe(false);
    expect("loadSharedDependency" in client).toBe(false);
    expect("registerShellModule" in client).toBe(false);
    expect("createServerReference" in client).toBe(false);
    expect("callServer" in client).toBe(false);
    expect("getFnId" in client).toBe(false);
    expect("getFnName" in client).toBe(false);
    expect("initTransportFromManifest" in client).toBe(false);
  });

  it("does not expose router construction APIs from the public client entry", () => {
    expect("createRoute" in client).toBe(false);
    expect("createRouter" in client).toBe(false);
    expect("createRootRoute" in client).toBe(false);
    expect("createRootRouteWithContext" in client).toBe(false);
    expect("createAppRootRoute" in client).toBe(false);
    expect("Outlet" in client).toBe(false);
    expect("RouterProvider" in client).toBe(false);
    expect("useParams" in client).toBe(false);
    expect("useSearch" in client).toBe(false);
    expect("useRouter" in client).toBe(false);
  });
});

describe("createPagesApp", () => {
  it("creates an app from page modules without exposing route tree setup", () => {
    function Home() {
      return null;
    }

    const { app } = createPagesApp({
      routes: [{ path: "/", module: { default: Home } }],
    });

    expect(app.render).toBeTypeOf("function");
    expect(app.unmount).toBeTypeOf("function");
    expect(app.queryClient).toBeDefined();
  });
});
