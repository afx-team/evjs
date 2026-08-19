import { QueryClientProvider } from "@tanstack/react-query";
import { createElement, memo, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPageMetadataController } from "../src/framework/page/page-metadata.js";
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
      basepath,
      history,
    });
    const router = app.router as {
      latestLocation: {
        pathname: string;
        search: Record<string, unknown>;
        searchStr: string;
      };
    };

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

  it("replaces runtime Route overlays without removing generated Routes", async () => {
    function Home() {
      return null;
    }

    const pagesApp = createPagesApp({
      routes: [{ id: "home", path: "/", module: { default: Home } }],
      history: { type: "memory", initialEntries: ["/catalog"] },
    });
    const router = pagesApp.app.router as {
      routeTree: InspectableGeneratedRoute;
    };

    await pagesApp.updateRuntime({
      routes: [{ id: "micro-catalog", path: "/catalog", kind: "group" }],
    });
    const catalogRouter = pagesApp.app.router as {
      routeTree: InspectableGeneratedRoute;
    };
    expect(catalogRouter).not.toBe(router);
    expect(generatedRoutePaths(catalogRouter.routeTree)).toEqual(
      expect.arrayContaining(["/", "/catalog"]),
    );

    await pagesApp.updateRuntime({
      routes: [{ id: "micro-orders", path: "/orders", kind: "group" }],
    });
    const ordersRouter = pagesApp.app.router as {
      routeTree: InspectableGeneratedRoute;
    };
    expect(ordersRouter).not.toBe(catalogRouter);
    const replacedPaths = generatedRoutePaths(ordersRouter.routeTree);
    expect(replacedPaths).toEqual(expect.arrayContaining(["/", "/orders"]));
    expect(replacedPaths).not.toContain("/catalog");

    await pagesApp.updateRuntime({ routes: [] });
    const clearedPaths = generatedRoutePaths(
      (pagesApp.app.router as { routeTree: InspectableGeneratedRoute })
        .routeTree,
    );
    expect(clearedPaths).toContain("/");
    expect(clearedPaths).not.toContain("/orders");
  });

  it("lets exact runtime Routes replace conflicting canonical Routes", async () => {
    function Home() {
      return null;
    }

    const pagesApp = createPagesApp({
      routes: [
        { id: "home", path: "/", module: { default: Home } },
        { id: "catalog", path: "/catalog", module: { default: Home } },
      ],
      history: { type: "memory", initialEntries: ["/catalog"] },
    });
    await pagesApp.updateRuntime({
      routes: [
        {
          id: "runtime-root",
          path: "/",
          kind: "redirect",
          redirect: { kind: "path", path: "/catalog" },
        },
      ],
    });

    const router = pagesApp.app.router as {
      routeTree: InspectableGeneratedRoute;
    };
    const runtimeRoot = flattenGeneratedRoutes(router.routeTree).find(
      (route) => route.options.beforeLoad,
    );
    expect(catchRedirectOptions(runtimeRoot)).toMatchObject({ to: "/catalog" });
  });

  it("lets wildcard runtime Routes take over canonical branches", async () => {
    function Page() {
      return null;
    }

    const pagesApp = createPagesApp({
      routes: [
        { id: "home", path: "/", module: { default: Page } },
        {
          id: "catalog",
          path: "/catalog",
          module: { default: Page },
        },
        {
          id: "catalog-orders",
          path: "/catalog/orders",
          module: { default: Page },
        },
        { id: "about", path: "/about", module: { default: Page } },
      ],
      history: { type: "memory", initialEntries: ["/catalog"] },
    });
    await pagesApp.updateRuntime({
      routes: [
        {
          id: "runtime-catalog",
          path: "/catalog/$",
          kind: "group",
        },
      ],
    });

    expect(
      generatedRoutePaths(
        (pagesApp.app.router as { routeTree: InspectableGeneratedRoute })
          .routeTree,
      ),
    ).toEqual(["/", "/", "/about", "/catalog/$"]);

    await pagesApp.updateRuntime({
      routes: [{ id: "runtime-root", path: "/$", kind: "group" }],
    });
    expect(
      generatedRoutePaths(
        (pagesApp.app.router as { routeTree: InspectableGeneratedRoute })
          .routeTree,
      ),
    ).toEqual(["/", "/$"]);

    await pagesApp.updateRuntime({ routes: [] });
    expect(
      generatedRoutePaths(
        (pagesApp.app.router as { routeTree: InspectableGeneratedRoute })
          .routeTree,
      ),
    ).toEqual(["/", "/", "/catalog", "/catalog/orders", "/about"]);
  });

  it("updates basepath and serializable history before the first render", async () => {
    function Home() {
      return null;
    }

    const pagesApp = createPagesApp({
      routes: [{ path: "/", module: { default: Home } }],
      history: {
        type: "memory",
        initialEntries: ["/catalog"],
      },
    });
    await pagesApp.updateRuntime({ basepath: "/catalog" });

    const router = pagesApp.app.router as {
      history: { location: { href: string } };
      latestLocation: { pathname: string };
      matchRoutes(pathname: string): unknown[];
    };
    expect(router.history.location.href).toBe("/catalog");
    expect(router.latestLocation.pathname).toBe("/");
    expect(router.matchRoutes("/").length).toBeGreaterThan(1);
  });

  it("reuses equivalent history descriptors across runtime updates", async () => {
    function Home() {
      return null;
    }

    const pagesApp = createPagesApp({
      routes: [{ path: "/", module: { default: Home } }],
      history: {
        type: "memory",
        initialEntries: ["/catalog"],
        initialIndex: 0,
      },
    });
    const router = pagesApp.app.router as { history: unknown };
    const initialHistory = router.history;

    await pagesApp.updateRuntime({
      history: {
        type: "memory",
        initialEntries: ["/catalog"],
        initialIndex: 0,
      },
    });
    await pagesApp.updateRuntime({
      history: {
        type: "memory",
        initialEntries: ["/catalog"],
        initialIndex: 0,
      },
    });

    expect(router.history).toBe(initialHistory);
  });

  it("releases owned browser history after a replacement Router commits", async () => {
    const nativePushState = vi.fn();
    const nativeReplaceState = vi.fn();
    const browserHistory = {
      state: {},
      length: 1,
      pushState: nativePushState,
      replaceState: nativeReplaceState,
      back: vi.fn(),
      forward: vi.fn(),
      go: vi.fn(),
    };
    const browserWindow = {
      history: browserHistory,
      location: { pathname: "/", search: "", hash: "" },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("document", {});
    vi.stubGlobal("window", browserWindow);
    vi.stubGlobal("self", browserWindow);

    function Home() {
      return null;
    }

    const pagesApp = createPagesApp({
      routes: [{ path: "/", module: { default: Home } }],
      history: { type: "browser" },
    });
    const router = pagesApp.app.router as {
      history: ReturnType<typeof client.createMemoryHistory>;
    };
    const ownedHistory = router.history;
    const destroy = vi.spyOn(ownedHistory, "destroy");
    const externalHistory = client.createMemoryHistory();

    await pagesApp.updateRuntime({ history: externalHistory });
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(pagesApp.app.router).not.toBe(router);
    expect((pagesApp.app.router as { history: unknown }).history).toBe(
      externalHistory,
    );
    expect(browserHistory.pushState).toBe(nativePushState);
    expect(browserHistory.replaceState).toBe(nativeReplaceState);
  });

  it("replaces the Router without mutating the previous Route state", async () => {
    function Home() {
      return null;
    }

    const pagesApp = createPagesApp({
      routes: [{ id: "home", path: "/", module: { default: Home } }],
      history: { type: "memory", initialEntries: ["/catalog"] },
    });
    await pagesApp.updateRuntime({
      routes: [{ id: "micro-catalog", path: "/catalog", kind: "group" }],
    });
    const router = pagesApp.app.router as {
      basepath: string;
      history: unknown;
      routeTree: InspectableGeneratedRoute;
      update(options: unknown): void;
    };
    const previousRouteTree = router.routeTree;
    const previousHistory = router.history;
    const previousBasepath = router.basepath;
    const queryClient = pagesApp.app.queryClient;
    await pagesApp.updateRuntime({
      routes: [{ id: "micro-orders", path: "/orders", kind: "group" }],
      basepath: "/workspace",
      history: { type: "memory", initialEntries: ["/workspace/orders"] },
    });

    expect(router.routeTree).toBe(previousRouteTree);
    expect(router.history).toBe(previousHistory);
    expect(router.basepath).toBe(previousBasepath);
    expect(generatedRoutePaths(router.routeTree)).toEqual(
      expect.arrayContaining(["/", "/catalog"]),
    );
    expect(generatedRoutePaths(router.routeTree)).not.toContain("/orders");
    const replacement = pagesApp.app.router as {
      basepath: string;
      routeTree: InspectableGeneratedRoute;
    };
    expect(replacement).not.toBe(router);
    expect(replacement.basepath).toBe("/workspace");
    expect(generatedRoutePaths(replacement.routeTree)).toEqual(
      expect.arrayContaining(["/", "/orders"]),
    );
    expect(pagesApp.app.queryClient).toBe(queryClient);
  });

  it("rejects invalid runtime inputs before changing the active Route tree", async () => {
    function Home() {
      return null;
    }

    const pagesApp = createPagesApp({
      routes: [{ path: "/", module: { default: Home } }],
      history: { type: "memory" },
    });
    const router = pagesApp.app.router as {
      routeTree: InspectableGeneratedRoute;
    };
    const previousRouteTree = router.routeTree;

    await expect(
      pagesApp.updateRuntime({
        routes: [
          {
            path: "catalog",
            kind: "group",
          },
        ],
      }),
    ).rejects.toThrow('routes[1].path must start with "/".');
    await expect(
      pagesApp.updateRuntime({
        history: { type: "memory", initialEntries: [] },
      }),
    ).rejects.toThrow(
      "updateRuntime() history.initialEntries must be a non-empty array",
    );

    expect(router.routeTree).toBe(previousRouteTree);
    expect(generatedRoutePaths(router.routeTree)).not.toContain("/catalog");
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

  it("attaches metadata only to generated Page route owners", () => {
    function Parent() {
      return null;
    }
    function Child() {
      return null;
    }

    const { app } = createPagesApp({
      routes: [
        {
          id: "parent",
          path: "/parent",
          module: { default: Parent },
          metadata: {
            title: "Parent",
            meta: { description: "Parent description" },
          },
        },
        {
          id: "child",
          path: "/parent/child",
          parentId: "parent",
          module: { default: Child },
        },
      ],
    });
    const generatedRoutes = flattenGeneratedRoutes(
      (app.router as unknown as { routeTree: InspectableGeneratedRoute })
        .routeTree,
    );
    const parent = generatedRoutes.find(
      (route) => route.fullPath === "/parent",
    );
    const child = generatedRoutes.find(
      (route) => route.fullPath === "/parent/child",
    );

    expect(parent?.options.staticData).toMatchObject({
      __evjsPageMetadataOwner: true,
      __evjsPageMetadata: {
        title: "Parent",
        meta: { description: "Parent description" },
      },
    });
    expect(child?.options.staticData).toEqual({
      __evjsPageMetadataOwner: true,
    });
  });

  it("isolates generated Page metadata from later caller mutations", () => {
    function Home() {
      return null;
    }
    const metadata = {
      title: "Home",
      meta: { description: "Original description" },
    };
    const routes = [
      {
        id: "home",
        path: "/",
        module: { default: Home },
        metadata,
      },
    ];

    const { app } = createPagesApp({ routes });
    metadata.title = "Mutated";
    metadata.meta.description = "Mutated description";
    Object.assign(metadata.meta, { robots: "noindex" });

    const generatedRoutes = flattenGeneratedRoutes(
      (app.router as unknown as { routeTree: InspectableGeneratedRoute })
        .routeTree,
    );
    const home = generatedRoutes.find(
      (route) => route.options.staticData?.__evjsPageMetadataOwner === true,
    );

    expect(home?.options.staticData).toMatchObject({
      __evjsPageMetadata: {
        title: "Home",
        meta: { description: "Original description" },
      },
    });
  });

  it("restores template metadata instead of leaking values across Pages", () => {
    const document = new MetadataTestDocument();
    const title = document.append("title", {
      "data-evjs-page-metadata": "title",
      "data-evjs-page-metadata-baseline": "Template title",
    });
    title.textContent = "Orders";
    document.append("meta", {
      name: "description",
      content: "Orders description",
      "data-evjs-page-metadata": "meta",
      "data-evjs-page-metadata-baseline": "Template description",
    });
    document.append("meta", {
      name: "Description",
      content: "Duplicate template description",
    });
    document.append("meta", {
      name: "robots",
      content: "noindex",
      "data-evjs-page-metadata": "meta",
      "data-evjs-page-metadata-created": "",
    });
    document.append("meta", { name: "viewport" });

    const controller = createPageMetadataController(
      [
        {
          title: "Orders",
          meta: {
            description: "Orders description",
            robots: "noindex",
          },
        },
        { meta: { viewport: "width=device-width" } },
      ],
      () => document as unknown as Document,
    );

    controller.apply({
      title: "Orders",
      meta: {
        description: "Orders description",
        robots: "noindex",
      },
    });
    expect(document.title()).toBe("Orders");
    expect(document.meta("description")?.getAttribute("content")).toBe(
      "Orders description",
    );
    expect(document.metas("description")).toHaveLength(1);
    expect(document.meta("robots")?.getAttribute("content")).toBe("noindex");

    controller.apply({ meta: { viewport: "width=device-width" } });
    expect(document.title()).toBe("Template title");
    expect(document.meta("description")?.getAttribute("content")).toBe(
      "Template description",
    );
    expect(document.meta("robots")).toBeUndefined();
    expect(document.meta("viewport")?.getAttribute("content")).toBe(
      "width=device-width",
    );

    controller.restore();
    expect(document.title()).toBe("Template title");
    expect(document.meta("description")?.getAttribute("content")).toBe(
      "Template description",
    );
    expect(document.meta("viewport")?.hasAttribute("content")).toBe(false);
    expect(
      document
        .elements()
        .some((element) =>
          [...element.attributes.keys()].some((name) =>
            name.startsWith("data-evjs-page-metadata"),
          ),
        ),
    ).toBe(false);
  });

  it("runs config-route groups, wrappers, nested pages, and redirects", () => {
    function Outer({ children }: { children?: ReactNode }) {
      return children;
    }
    function Inner({ children }: { children?: ReactNode }) {
      return children;
    }
    function User() {
      return null;
    }
    function Shell() {
      return null;
    }
    function Detail() {
      return null;
    }
    function Docs() {
      return null;
    }
    function AdminDetail() {
      return null;
    }

    const { app } = createPagesApp({
      routes: [
        {
          id: "users",
          path: "/users",
          kind: "group",
          wrappers: [{ default: Outer }, { default: Inner }],
        },
        {
          id: "user",
          path: "/users/$userId",
          parentId: "users",
          module: { default: User },
        },
        {
          id: "legacy-user",
          path: "/users/$userId/legacy",
          parentId: "users",
          kind: "redirect",
          redirect: { kind: "path", path: "/users/$userId" },
        },
        {
          id: "shell",
          path: "/shell",
          module: { default: Shell },
        },
        {
          id: "shell-detail",
          path: "/shell/detail",
          parentId: "shell",
          module: { default: Detail },
        },
        { id: "docs", path: "/docs", kind: "group" },
        {
          id: "docs-index",
          path: "/docs",
          parentId: "docs",
          module: { default: Docs },
        },
        { id: "admin", path: "/admin", kind: "group" },
        {
          id: "admin-detail",
          path: "/admin/detail",
          parentId: "admin",
          module: { default: AdminDetail },
        },
        {
          id: "external",
          path: "/external",
          kind: "redirect",
          redirect: { kind: "url", href: "https://example.com/docs" },
        },
      ],
    });
    const router = app.router as unknown as {
      routeTree: InspectableGeneratedRoute;
      matchRoutes(path: string): Array<{ params: Record<string, string> }>;
      update(options: {
        history: ReturnType<typeof client.createMemoryHistory>;
      }): void;
    };
    router.update({ history: client.createMemoryHistory() });

    expect(router.matchRoutes("/users/42").at(-1)?.params).toMatchObject({
      userId: "42",
    });
    expect(router.matchRoutes("/docs").length).toBeGreaterThanOrEqual(2);
    expect(router.matchRoutes("/admin/detail").length).toBeGreaterThanOrEqual(
      2,
    );

    const generatedRoutes = flattenGeneratedRoutes(router.routeTree);
    const usersRoute = generatedRoutes.find(
      (route) => route.fullPath === "/users",
    );
    const wrappedGroup = usersRoute?.options.component?.() as
      | InspectableElement
      | undefined;
    expect(wrappedGroup?.type).toBe(Outer);
    expect(wrappedGroup?.props.children?.type).toBe(Inner);
    expect(wrappedGroup?.props.children?.props.children?.type).toBe(
      client.Outlet,
    );

    const shellRoute = generatedRoutes.find(
      (route) => route.fullPath === "/shell",
    );
    if (!shellRoute) throw new Error("missing generated shell route");
    shellRoute.useParams = () => ({});
    shellRoute.useSearch = () => ({});
    shellRoute.useLoaderData = () => undefined;
    const shellProvider =
      shellRoute.options.component?.() as InspectableElement;
    const shell = shellProvider.props.children;
    expect(shell?.type).toBe(Shell);
    expect(shell?.props.children?.type).toBe(client.Outlet);

    const internalRedirect = generatedRoutes.find(
      (route) => route.fullPath === "/users/$userId/legacy",
    );
    expect(catchRedirectOptions(internalRedirect)).toMatchObject({
      to: "/users/$userId",
      params: true,
    });
    const externalRedirect = generatedRoutes.find(
      (route) => route.fullPath === "/external",
    );
    expect(catchRedirectOptions(externalRedirect)).toMatchObject({
      href: "https://example.com/docs",
      reloadDocument: true,
    });
  });

  it("bypasses the Application root layout only for layout: false branches", async () => {
    function RootLayout({ children }: { children?: ReactNode }) {
      return createElement("main", { "data-root-layout": true }, children);
    }
    function Regular() {
      return createElement("p", undefined, "regular");
    }
    function Plain() {
      return createElement("p", undefined, "plain");
    }
    function NestedPlain() {
      return createElement("p", undefined, "nested plain");
    }

    async function renderRoute(initialPath: string): Promise<string> {
      const { app } = createPagesApp({
        rootModule: { default: RootLayout },
        routes: [
          {
            id: "regular",
            path: "/regular",
            module: { default: Regular },
          },
          {
            id: "plain",
            path: "/plain",
            module: { default: Plain },
            layout: false,
          },
          {
            id: "plain-group",
            path: "/group",
            kind: "group",
            layout: false,
          },
          {
            id: "nested-plain",
            path: "/group/plain",
            parentId: "plain-group",
            module: { default: NestedPlain },
          },
        ],
      });
      const router = app.router as client.AnyRouter;
      router.update({
        history: client.createMemoryHistory({ initialEntries: [initialPath] }),
      });
      await router.load();
      return renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client: app.queryClient },
          createElement(client.RouterProvider, { router }),
        ),
      );
    }

    expect(await renderRoute("/regular")).toContain("data-root-layout");
    expect(await renderRoute("/plain")).not.toContain("data-root-layout");
    expect(await renderRoute("/group/plain")).not.toContain("data-root-layout");
  });

  it("keeps Application wrappers around routes that bypass the root layout", async () => {
    function OuterApplicationWrapper({ children }: { children?: ReactNode }) {
      return createElement(
        "section",
        { "data-application-wrapper": "outer" },
        children,
      );
    }
    function InnerApplicationWrapper({ children }: { children?: ReactNode }) {
      return createElement(
        "article",
        { "data-application-wrapper": "inner" },
        children,
      );
    }
    function RootLayout({ children }: { children?: ReactNode }) {
      return createElement("main", { "data-root-layout": true }, children);
    }
    function Plain() {
      return createElement("p", undefined, "plain");
    }
    const { app } = createPagesApp({
      wrappers: [
        { default: OuterApplicationWrapper },
        { default: InnerApplicationWrapper },
      ],
      rootModule: { default: RootLayout },
      routes: [
        {
          path: "/plain",
          module: { default: Plain },
          layout: false,
        },
      ],
      history: { type: "memory", initialEntries: ["/plain"] },
    });
    const router = app.router as client.AnyRouter;
    await router.load();
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: app.queryClient },
        createElement(client.RouterProvider, { router }),
      ),
    );

    expect(html).toContain('data-application-wrapper="outer"');
    expect(html).toContain('data-application-wrapper="inner"');
    expect(html.indexOf('data-application-wrapper="outer"')).toBeLessThan(
      html.indexOf('data-application-wrapper="inner"'),
    );
    expect(html).not.toContain("data-root-layout");
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
      createPagesApp({
        routes: [
          {
            path: "/",
            module: { default: Home },
            metadata: { title: 42 as never },
          },
        ],
      }),
    ).toThrow(
      "[evjs] createPagesApp() routes[0].metadata.title must be a string.",
    );
    expect(() =>
      createPagesApp({
        routes: [
          {
            path: "/",
            module: { default: Home },
            metadata: { meta: { "": "invalid" } },
          },
        ],
      }),
    ).toThrow(
      "[evjs] createPagesApp() routes[0].metadata.meta keys must be non-empty strings.",
    );
    expect(() =>
      createPagesApp({
        routes: [
          {
            path: "/",
            kind: "layout",
            module: { default: Home },
            metadata: { title: "Invalid" },
          },
        ],
      }),
    ).toThrow(
      "[evjs] createPagesApp() routes[0].metadata is only supported for page routes.",
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
      '[evjs] createPagesApp() routes[1].path "/" conflicts with sibling routes[0].path "/" under the root route because they have the same runtime path shape.',
    );
    expect(() =>
      createPagesApp({
        routes: [
          { path: "/users/$id", module: { default: Home } },
          { path: "/users/$userId", module: { default: Home } },
        ],
      }),
    ).toThrow(
      '[evjs] createPagesApp() routes[1].path "/users/$userId" conflicts with sibling routes[0].path "/users/$id" under the root route because they have the same runtime path shape.',
    );
    expect(() =>
      createPagesApp({
        routes: [
          { id: "users-group", path: "/users", kind: "group" },
          { id: "users-page", path: "/users", module: { default: Home } },
        ],
      }),
    ).toThrow(
      '[evjs] createPagesApp() routes[1].path "/users" conflicts with sibling routes[0].path "/users" under the root route because they have the same runtime path shape.',
    );
    expect(() =>
      createPagesApp({
        routes: [
          { id: "admin-a", path: "/admin", kind: "group" },
          { id: "admin-b", path: "/admin", kind: "group" },
        ],
      }),
    ).toThrow(
      '[evjs] createPagesApp() routes[1].path "/admin" conflicts with sibling routes[0].path "/admin" under the root route because they have the same runtime path shape.',
    );
    expect(() =>
      createPagesApp({
        routes: [
          { id: "shell", path: "/shell", kind: "group" },
          {
            id: "branch-a",
            path: "/shell",
            parentId: "shell",
            kind: "group",
          },
          {
            id: "branch-b",
            path: "/shell",
            parentId: "shell",
            kind: "group",
          },
          {
            id: "item-a",
            path: "/shell/item",
            parentId: "branch-a",
            module: { default: Home },
          },
          {
            id: "item-b",
            path: "/shell/item",
            parentId: "branch-b",
            module: { default: Home },
          },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      createPagesApp({
        routes: [
          { id: "root-group", path: "/", kind: "group" },
          { id: "root-page", path: "/", module: { default: Home } },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      createPagesApp({
        routes: [
          {
            id: "redirect",
            path: "/old",
            kind: "redirect",
            redirect: { kind: "path", path: "/new" },
          },
          {
            id: "settings",
            path: "/settings",
            parentId: "redirect",
            module: { default: Home },
          },
        ],
      }),
    ).toThrow(
      '[evjs] Page route "settings" parentId "redirect" must not reference a redirect route.',
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

interface InspectableElement {
  type: unknown;
  props: {
    children?: InspectableElement;
  };
}

interface InspectableGeneratedRoute {
  fullPath?: string;
  children?: InspectableGeneratedRoute[];
  options: {
    component?: () => unknown;
    beforeLoad?: () => unknown;
    staticData?: Record<string, unknown>;
  };
  useParams(): unknown;
  useSearch(): unknown;
  useLoaderData(): unknown;
}

function flattenGeneratedRoutes(
  route: InspectableGeneratedRoute,
): InspectableGeneratedRoute[] {
  return [
    route,
    ...(route.children ?? []).flatMap((child) => flattenGeneratedRoutes(child)),
  ];
}

function generatedRoutePaths(route: InspectableGeneratedRoute): string[] {
  return flattenGeneratedRoutes(route).flatMap((candidate) =>
    candidate.fullPath ? [candidate.fullPath] : [],
  );
}

function catchRedirectOptions(
  route: InspectableGeneratedRoute | undefined,
): Record<string, unknown> {
  if (!route?.options.beforeLoad) {
    throw new Error("missing generated redirect route");
  }
  try {
    route.options.beforeLoad();
  } catch (error) {
    return (error as { options: Record<string, unknown> }).options;
  }
  throw new Error("generated redirect beforeLoad did not redirect");
}

class MetadataTestElement {
  readonly attributes = new Map<string, string>();
  parent?: MetadataTestHead;
  textContent: string | null = null;

  constructor(readonly tagName: string) {}

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  remove(): void {
    this.parent?.remove(this);
  }
}

class MetadataTestHead {
  readonly children: MetadataTestElement[] = [];

  constructor(readonly ownerDocument: MetadataTestDocument) {}

  append(element: MetadataTestElement): void {
    element.parent?.remove(element);
    element.parent = this;
    this.children.push(element);
  }

  contains(element: MetadataTestElement): boolean {
    return this.children.includes(element);
  }

  querySelector(selector: string): MetadataTestElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MetadataTestElement[] {
    if (selector === "title") {
      return this.children.filter((element) => element.tagName === "title");
    }
    if (selector === "meta[name]") {
      return this.children.filter(
        (element) => element.tagName === "meta" && element.hasAttribute("name"),
      );
    }
    throw new Error(`Unsupported metadata test selector: ${selector}`);
  }

  remove(element: MetadataTestElement): void {
    const index = this.children.indexOf(element);
    if (index >= 0) this.children.splice(index, 1);
    element.parent = undefined;
  }
}

class MetadataTestDocument {
  readonly head = new MetadataTestHead(this);

  createElement(tagName: string): MetadataTestElement {
    return new MetadataTestElement(tagName);
  }

  append(
    tagName: string,
    attributes: Record<string, string>,
  ): MetadataTestElement {
    const element = this.createElement(tagName);
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    this.head.append(element);
    return element;
  }

  elements(): MetadataTestElement[] {
    return this.head.children;
  }

  title(): string {
    return this.head.querySelector("title")?.textContent ?? "";
  }

  meta(name: string): MetadataTestElement | undefined {
    return this.metas(name)[0];
  }

  metas(name: string): MetadataTestElement[] {
    const identity = name.toLowerCase();
    return this.head
      .querySelectorAll("meta[name]")
      .filter(
        (element) => element.getAttribute("name")?.toLowerCase() === identity,
      );
  }
}
