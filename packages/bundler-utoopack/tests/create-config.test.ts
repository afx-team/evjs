import { describe, expect, it } from "vitest";
import { createUtoopackConfig } from "../src/adapter/create-config.js";

const DOCUMENT_FALLBACK_CONTEXT =
  "^/(?!api(?:/|$))(?!turbopack-hmr$)(?!.*\\.(?:avif|css|gif|ico|jpe?g|js|json|map|mjs|otf|png|svg|ttf|txt|wasm|webp|woff2?|xml)$).*";

describe("createUtoopackConfig", () => {
  function createResolvedConfig(
    overrides: Partial<Parameters<typeof createUtoopackConfig>[0]> = {},
  ): Parameters<typeof createUtoopackConfig>[0] {
    return {
      entry: "./src/main.tsx",
      html: "./index.html",
      dev: {
        port: 41234,
        https: true,
        proxy: [],
      },
      serverEnabled: false,
      server: {
        functions: {
          endpoint: "api/fn",
          clientProxy: "@evjs/client/transport",
          serverRegister: "@evjs/server/register",
        },
        dev: {
          port: 3001,
          https: false,
        },
      },
      ssr: {
        enabled: false,
        mode: "stream",
      },
      plugins: [],
      ...overrides,
    };
  }

  it("passes resolved dev server options and SPA fallback to Utoopack", async () => {
    const config = createResolvedConfig();

    const utoopackConfig = await createUtoopackConfig(
      config,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.devServer?.port).toBe(41234);
    expect(utoopackConfig.devServer?.https).toBe(true);
    expect(utoopackConfig.devServer?.proxy).toContainEqual(
      expect.objectContaining({
        context: [DOCUMENT_FALLBACK_CONTEXT],
        target: "https://localhost:41234",
      }),
    );
  });

  it("uses a document fallback context that keeps assets and APIs out", () => {
    const re = new RegExp(DOCUMENT_FALLBACK_CONTEXT);

    expect(re.test("/")).toBe(true);
    expect(re.test("/about")).toBe(true);
    expect(re.test("/users/john.doe")).toBe(true);
    expect(re.test("/api/health")).toBe(false);
    expect(re.test("/main.js")).toBe(false);
    expect(re.test("/assets/app.123.css")).toBe(false);
    expect(re.test("/turbopack-hmr")).toBe(false);
  });

  it("does not add SPA history fallback for MPA builds", async () => {
    const config = createResolvedConfig({
      pages: {
        home: { entry: "./src/home.tsx", html: "./home.html" },
        about: { entry: "./src/about.tsx", html: "./about.html" },
      },
    });

    const utoopackConfig = await createUtoopackConfig(
      config,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.entry).toEqual([
      { import: "./src/home.tsx", name: "home" },
      { import: "./src/about.tsx", name: "about" },
    ]);
    expect(utoopackConfig.devServer?.proxy).toEqual([]);
  });

  it("awaits async bundlerConfig hooks before returning config", async () => {
    const config = createResolvedConfig();

    const utoopackConfig = await createUtoopackConfig(config, process.cwd(), [
      {
        async bundlerConfig(cfg) {
          await Promise.resolve();
          cfg.output ??= {};
          cfg.output.publicPath = "runtime";
        },
      },
    ]);

    expect(utoopackConfig.output?.publicPath).toBe("runtime");
  });

  it("proxies document requests to the API server when SSR is enabled", async () => {
    const config = createResolvedConfig({
      serverEnabled: true,
      server: {
        functions: {
          endpoint: "api/fn",
          clientProxy: "@evjs/client/transport",
          serverRegister: "@evjs/server/register",
        },
        dev: {
          port: 51337,
          https: false,
        },
      },
      ssr: {
        enabled: true,
        mode: "stream",
      },
    });

    const utoopackConfig = await createUtoopackConfig(
      config,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.devServer?.proxy).toContainEqual(
      expect.objectContaining({
        context: [DOCUMENT_FALLBACK_CONTEXT],
        target: "http://localhost:51337",
      }),
    );
  });

  it("defines SSR runtime constants", async () => {
    const config = createResolvedConfig({
      ssr: {
        enabled: true,
        mode: "stream",
      },
    });

    const utoopackConfig = await createUtoopackConfig(
      config,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.define).toMatchObject({
      "process.env.EVJS_SSR": JSON.stringify("true"),
      "process.env.EVJS_SSR_MODE": JSON.stringify("stream"),
      __EVJS_SSR__: JSON.stringify(true),
      __EVJS_SSR_MODE__: JSON.stringify("stream"),
    });
  });

  it("aliases TanStack router runtime environment detection", async () => {
    const config = createResolvedConfig();

    const utoopackConfig = await createUtoopackConfig(
      config,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.resolve?.alias).toMatchObject({
      "@tanstack/router-core/isServer": expect.stringContaining(
        "runtime/tanstack-router-is-server.js",
      ),
    });
  });
});
