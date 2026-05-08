import { describe, expect, it } from "vitest";
import { createUtoopackConfig } from "../src/adapter/create-config.js";

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
        endpoint: "/api/fn",
        functions: {
          clientProxy: "@evjs/client/transport",
          serverRegister: "@evjs/server/register",
        },
        dev: {
          port: 3001,
          https: false,
        },
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
        context: ["^/(?!api(?:/|$))(?!turbopack-hmr$)(?!.*\\.[^/]+$).+"],
        target: "https://localhost:41234",
      }),
    );
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
});
