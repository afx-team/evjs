import { memo } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../src/index";
import {
  usePageContext,
  usePageLoaderData,
  usePageParams,
  usePageSearch,
} from "../src/index";
import { createPagesApp } from "../src/internal";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("page route hooks", () => {
  it("exports framework-managed route data hooks", () => {
    expect(usePageContext).toBeTypeOf("function");
    expect(usePageParams).toBeTypeOf("function");
    expect(usePageSearch).toBeTypeOf("function");
    expect(usePageLoaderData).toBeTypeOf("function");
  });

  it("exposes standalone CSR APIs without exposing generated bootstrap internals", () => {
    expect("createApp" in client).toBe(true);
    expect("createPagesApp" in client).toBe(false);
    expect("PageProvider" in client).toBe(false);
    expect("startPageRuntime" in client).toBe(false);
    expect("createReactPageModule" in client).toBe(false);
    expect("mountReactPage" in client).toBe(false);
    expect("createShell" in client).toBe(false);
    expect("createPageDriver" in client).toBe(false);
    expect("createHistoryDriver" in client).toBe(false);
    expect("registerShellModule" in client).toBe(false);
    expect("createServerReference" in client).toBe(false);
    expect("callServer" in client).toBe(false);
    expect("getFnId" in client).toBe(false);
    expect("getFnName" in client).toBe(true);
    expect("initTransportFromRuntime" in client).toBe(false);
  });

  it("exposes manual router construction APIs for standalone CSR apps", () => {
    expect("createRoute" in client).toBe(true);
    expect("createRouter" in client).toBe(true);
    expect("createRootRoute" in client).toBe(true);
    expect("createRootRouteWithContext" in client).toBe(true);
    expect("createAppRootRoute" in client).toBe(true);
    expect("Outlet" in client).toBe(true);
    expect("RouterProvider" in client).toBe(true);
    expect("useParams" in client).toBe(true);
    expect("useSearch" in client).toBe(true);
    expect("useRouter" in client).toBe(true);
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

  it("keeps generated SPA search params as raw strings", () => {
    function Home() {
      return null;
    }

    const spaceId = "2026071515292425600064506";
    const basepath = "/ai-center/linkque";
    const initialUrl = `${basepath}/home?spaceId=${spaceId}&enabled=true&config=%7B%22a%22%3A1%7D`;
    const history = client.createMemoryHistory({
      initialEntries: [initialUrl],
    });
    const { app } = createPagesApp({
      routes: [{ path: "/home", module: { default: Home } }],
    });
    const router = app.router as {
      latestLocation: {
        pathname: string;
        search: Record<string, unknown>;
        searchStr: string;
      };
      options: Record<string, unknown>;
      routeTree: unknown;
      update(options: Record<string, unknown>): void;
    };

    router.update({
      ...router.options,
      routeTree: router.routeTree,
      basepath,
      history,
    });

    expect(router.latestLocation.search).toEqual({
      spaceId,
      enabled: "true",
      config: '{"a":1}',
    });
    expect(router.latestLocation.searchStr).toBe(
      `?spaceId=${spaceId}&enabled=true&config=%7B%22a%22%3A1%7D`,
    );
    expect(router.latestLocation.pathname).toBe("/home");
    expect(history.location.href).toBe(initialUrl);
  });

  it("matches wildcard page routes from generated public route paths", () => {
    function DocsFallback() {
      return null;
    }

    const { app } = createPagesApp({
      routes: [
        {
          id: "docs_splat",
          path: "/docs/$",
          module: { default: DocsFallback },
        },
      ],
    });
    const router = app.router as {
      buildLocation(options: { to: string; params: { _splat: string } }): {
        href: string;
        pathname: string;
      };
      matchRoutes(path: string): Array<{ params: Record<string, string> }>;
      update(options: {
        history: ReturnType<typeof client.createMemoryHistory>;
      }): void;
    };
    router.update({ history: client.createMemoryHistory() });

    const matches = router.matchRoutes("/docs/guides/install");
    expect(matches[matches.length - 1]?.params).toMatchObject({
      "*": "guides/install",
      _splat: "guides/install",
    });
    expect(
      router.buildLocation({
        to: "/docs/$",
        params: { _splat: "guides/install" },
      }),
    ).toMatchObject({
      href: "/docs/guides/install",
      pathname: "/docs/guides/install",
    });
  });

  it("reports SPA render container errors with evjs diagnostics", () => {
    function Home() {
      return null;
    }

    const { app } = createPagesApp({
      routes: [{ path: "/", module: { default: Home } }],
    });

    expect(() => app.render("")).toThrow(
      "[evjs] App container selector must be a non-empty string.",
    );
    expect(() => app.render(" #app ")).toThrow(
      "[evjs] App container selector must not include leading or trailing whitespace.",
    );
    expect(() => app.render(42 as never)).toThrow(
      "[evjs] App container must be a selector string or HTMLElement.",
    );
    expect(() => app.render("#app")).toThrow(
      '[evjs] Document is not available to resolve app container selector "#app".',
    );

    vi.stubGlobal("document", {});
    expect(() => app.render("#app")).toThrow(
      "[evjs] App container selector document.querySelector must be a function.",
    );

    vi.stubGlobal("document", {
      querySelector() {
        return null;
      },
    });
    expect(() => app.render("#app")).toThrow(
      "[evjs] Could not find app container element: #app",
    );

    vi.stubGlobal("document", {
      querySelector() {
        throw new SyntaxError("bad selector");
      },
    });
    expect(() => app.render("##bad")).toThrow(
      '[evjs] App container selector "##bad" is invalid: bad selector',
    );
  });

  it("accepts wrapped React components from generated page modules", () => {
    const Home = memo(function Home() {
      return null;
    });
    const RootLayout = memo(function RootLayout() {
      return null;
    });
    const Pending = memo(function Pending() {
      return null;
    });

    const { app } = createPagesApp({
      rootModule: { default: RootLayout },
      routes: [
        { path: "/", module: { default: Home, pendingComponent: Pending } },
      ],
    });

    expect(app.render).toBeTypeOf("function");
  });

  it("accepts nested layout route definitions from generated page modules", () => {
    function RootLayout() {
      return null;
    }
    function PostsLayout() {
      return null;
    }
    function Post() {
      return null;
    }

    const { app } = createPagesApp({
      routes: [
        {
          id: "layout",
          path: "/",
          kind: "layout",
          module: { default: RootLayout, loader: () => "root" },
        },
        {
          id: "posts_layout",
          path: "/posts",
          parentId: "layout",
          kind: "layout",
          module: { default: PostsLayout, beforeLoad: () => undefined },
        },
        {
          id: "posts_postId",
          path: "/posts/$postId",
          parentId: "posts_layout",
          module: { default: Post },
        },
      ],
    });

    expect(app.render).toBeTypeOf("function");
  });

  it("rejects malformed generated page route options before router setup", () => {
    function Home() {
      return null;
    }

    expect(() => createPagesApp(null as never)).toThrow(
      "[evjs] createPagesApp() options must be an object.",
    );
    expect(() => createPagesApp({ routes: { path: "/" } as never })).toThrow(
      "[evjs] createPagesApp() routes must be an array.",
    );
    expect(() =>
      createPagesApp({
        routes: [{ path: "/", module: { default: Home } }],
        rootModule: null as never,
      }),
    ).toThrow("[evjs] createPagesApp() rootModule must be an object.");
    expect(() =>
      createPagesApp({
        routes: [{ path: "/", module: { default: Home } }],
        rootModule: { default: "Layout" as never },
      }),
    ).toThrow(
      "[evjs] createPagesApp() rootModule.default must be a React component.",
    );
    expect(() =>
      createPagesApp({ routes: [{ path: "home", module: { default: Home } }] }),
    ).toThrow('[evjs] createPagesApp() routes[0].path must start with "/".');
    expect(() =>
      createPagesApp({
        routes: [{ path: "/home page", module: { default: Home } }],
      }),
    ).toThrow(
      "[evjs] createPagesApp() routes[0].path must not contain whitespace.",
    );
    expect(() =>
      createPagesApp({
        routes: [{ path: "/home?tab=latest", module: { default: Home } }],
      }),
    ).toThrow(
      "[evjs] createPagesApp() routes[0].path must not include a query string or hash.",
    );
    expect(() =>
      createPagesApp({
        routes: [{ path: "/home#main", module: { default: Home } }],
      }),
    ).toThrow(
      "[evjs] createPagesApp() routes[0].path must not include a query string or hash.",
    );
    expect(() =>
      createPagesApp({
        routes: [{ path: "/session/:__proto__", module: { default: Home } }],
      }),
    ).toThrow(
      '[evjs] createPagesApp() routes[0].path uses reserved dynamic param name "__proto__" in segment ":__proto__". Use a safe application-specific name.',
    );
    expect(() =>
      createPagesApp({
        routes: [{ path: "/docs/:_splat", module: { default: Home } }],
      }),
    ).toThrow(
      '[evjs] createPagesApp() routes[0].path uses reserved dynamic param name "_splat" in segment ":_splat". Use a safe application-specific name.',
    );
    expect(() =>
      createPagesApp({
        routes: [{ path: "/docs/$/edit/$", module: { default: Home } }],
      }),
    ).toThrow(
      '[evjs] createPagesApp() routes[0].path contains more than one wildcard segment "$". Use at most one wildcard segment in a route path.',
    );
    expect(() =>
      createPagesApp({
        routes: [{ path: "/docs/*", module: { default: Home } }],
      }),
    ).toThrow(
      '[evjs] createPagesApp() routes[0].path uses "*" as a wildcard segment. Use "$" for page route splats.',
    );
    expect(() =>
      createPagesApp({
        routes: [{ path: "/session/:", module: { default: Home } }],
      }),
    ).toThrow(
      '[evjs] createPagesApp() routes[0].path contains dynamic segment ":" without a param name.',
    );
    expect(() =>
      createPagesApp({
        routes: [
          { path: "/teams/:teamId/users/:teamId", module: { default: Home } },
        ],
      }),
    ).toThrow(
      '[evjs] createPagesApp() routes[0].path uses duplicate dynamic param name "teamId" in segment ":teamId". Use unique param names within one route path.',
    );
    expect(() =>
      createPagesApp({
        routes: [
          { path: "/", module: { default: Home } },
          { path: "/", module: { default: Home } },
        ],
      }),
    ).toThrow(
      '[evjs] createPagesApp() routes[1].path duplicates routes[0].path "/".',
    );
    expect(() =>
      createPagesApp({
        routes: [
          { path: "/users/$id", module: { default: Home } },
          { path: "/users/$userId", module: { default: Home } },
        ],
      }),
    ).toThrow(
      '[evjs] createPagesApp() routes[1].path "/users/$userId" has the same route shape as routes[0].path "/users/$id". Use one dynamic param name for each URL shape.',
    );
    expect(() =>
      createPagesApp({
        routes: [
          {
            id: "dashboard",
            path: "/dashboard",
            module: { default: Home },
          },
          {
            id: "settings",
            path: "/settings",
            parentId: "dashboard",
            module: { default: Home },
          },
        ],
      }),
    ).toThrow(
      '[evjs] Page route "settings" parentId "dashboard" must reference a layout route.',
    );
    expect(() =>
      createPagesApp({
        routes: [
          {
            id: "settings",
            path: "/settings",
            parentId: "missing",
            module: { default: Home },
          },
        ],
      }),
    ).toThrow(
      '[evjs] Page route "settings" parentId "missing" does not match another route id.',
    );
    expect(() =>
      createPagesApp({ routes: [{ path: "/", module: {} }] }),
    ).toThrow("[evjs] Page route / must export a default React component.");
    expect(() =>
      createPagesApp({
        routes: [
          {
            path: "/",
            module: { default: "Home" as never },
          },
        ],
      }),
    ).toThrow("[evjs] Page route / default export must be a React component.");
    expect(() =>
      createPagesApp({
        routes: [
          {
            path: "/",
            module: { default: Home, loader: "load" as never },
          },
        ],
      }),
    ).toThrow(
      "[evjs] createPagesApp() routes[0].module.loader must be a function.",
    );
    expect(() =>
      createPagesApp({
        routes: [
          {
            path: "/",
            module: {
              default: Home,
              pendingComponent: "Loading" as never,
            },
          },
        ],
      }),
    ).toThrow(
      "[evjs] createPagesApp() routes[0].module.pendingComponent must be a React component.",
    );
  });
});
