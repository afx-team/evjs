import { describe, expect, it } from "vitest";
import type { BundlerAdapter } from "../src/_internal/build/bundler.js";
import {
  CONFIG_DEFAULTS,
  defineConfig,
  resolveConfig,
} from "../src/config/index.js";

describe("defineConfig", () => {
  it("returns the config object unchanged", () => {
    const config = { html: "./index.html" };
    expect(defineConfig(config)).toBe(config);
  });

  it("accepts an empty config", () => {
    const config = {};
    expect(defineConfig(config)).toBe(config);
  });

  it("does not expose a server.functions endpoint config", () => {
    const config = defineConfig({
      server: {
        // @ts-expect-error server function URLs are derived from server.basePath.
        functions: { endpoint: "/api/rpc" },
      },
    });

    expect(config.server).toEqual({
      functions: { endpoint: "/api/rpc" },
    });
  });

  it("accepts a single app declaration", () => {
    const config = defineConfig({
      app: { entry: "./src/main.tsx" },
    });

    expect(config).toEqual({ app: { entry: "./src/main.tsx" } });
  });

  it("accepts routing configuration", () => {
    const config = defineConfig({
      routing: {
        dir: "./src/pages",
        conventions: {
          layout: "./src/shell/AppLayout.tsx",
        },
        mount: "#root",
      },
    });

    expect(config).toEqual({
      routing: {
        dir: "./src/pages",
        conventions: {
          layout: "./src/shell/AppLayout.tsx",
        },
        mount: "#root",
      },
    });
  });

  it("accepts server routing configuration", () => {
    const config = defineConfig({
      server: {
        routing: {
          dir: "./src/apis",
        },
      },
    });

    expect(config).toEqual({
      server: {
        routing: {
          dir: "./src/apis",
        },
      },
    });
  });

  it("accepts server convention configuration", () => {
    const config = defineConfig({
      server: {
        conventions: {
          middleware: false,
        },
      },
    });

    expect(config).toEqual({
      server: {
        conventions: {
          middleware: false,
        },
      },
    });
  });

  it("accepts output crossorigin loading configuration", () => {
    const config = defineConfig({
      output: {
        crossOriginLoading: "anonymous",
      },
    });

    expect(config).toEqual({
      output: {
        crossOriginLoading: "anonymous",
      },
    });
  });
});

describe("resolveConfig", () => {
  it("applies all defaults when called with no arguments", () => {
    const resolved = resolveConfig();
    expect(resolved.entry).toBe(CONFIG_DEFAULTS.entry);
    expect(resolved.html).toBe(CONFIG_DEFAULTS.html);
    expect(resolved.dev.port).toBe(CONFIG_DEFAULTS.port);
    expect(resolved.dev.https).toBe(false);
    expect(resolved.server.basePath).toBe("/__evjs");
    expect(resolved.server.runtime).toEqual({
      basePath: "/__evjs",
      fn: "/__evjs/fn",
      ppr: "/__evjs/ppr",
      rsc: "/__evjs/rsc",
    });
    expect(resolved.server.runtime.fn).toBe("/__evjs/fn");
    expect(resolved.server.routing).toBeUndefined();
    expect(resolved.transport).toEqual({ baseUrl: undefined });
    expect(resolved.apps).toBeUndefined();
    expect(resolved.routing).toBeUndefined();
    expect(resolved.server.dev.port).toBe(CONFIG_DEFAULTS.serverPort);
    expect(resolved.server.dev.https).toBe(false);
    expect(resolved.output).toEqual({
      client: "dist/client",
      server: "dist/server",
      crossOriginLoading: CONFIG_DEFAULTS.crossOriginLoading,
    });
    expect(resolved.bundler).toBeUndefined();
    expect(resolved.plugins).toEqual([]);
  });

  it("rejects invalid root config declarations", () => {
    expect(() => resolveConfig(null as never)).toThrow(
      "[evjs] config must be a config object.",
    );

    expect(() => resolveConfig([] as never)).toThrow(
      "[evjs] config must be a config object.",
    );

    expect(() =>
      resolveConfig({
        // @ts-expect-error runtime config loading can still produce unknown keys.
        routes: [],
      }),
    ).toThrow(
      "[evjs] config.routes is not a public config field. Use routing for file routes or pages for explicit page outputs.",
    );

    expect(() =>
      resolveConfig({
        // @ts-expect-error runtime config loading can still produce resolved metadata.
        apps: {},
      }),
    ).toThrow(
      "[evjs] config.apps is resolved framework metadata and cannot be configured. Use app for one explicit SPA, routing for file routes, or pages for explicit page outputs.",
    );

    expect(() =>
      resolveConfig({
        // @ts-expect-error runtime config loading can still produce unknown keys.
        serverFunctions: {},
      }),
    ).toThrow(
      '[evjs] config.serverFunctions is not a public config field. Server functions are discovered from "use server" modules and endpoints are derived from server.basePath.',
    );

    expect(() =>
      resolveConfig({
        // @ts-expect-error runtime config loading can still produce unknown keys.
        entry: "./src/main.tsx",
      }),
    ).toThrow(
      "[evjs] config.entry is not a public config field. Use app.entry for a manually bootstrapped SPA, routing for file routes, or pages for explicit page outputs.",
    );

    expect(() =>
      resolveConfig({
        // @ts-expect-error runtime config loading can still produce unknown keys.
        vite: {},
      }),
    ).toThrow(
      "[evjs] config.vite is not supported. Use html, output, dev, server, transport, app, routing, bundler, plugins, or pages.",
    );
  });

  it("resolves output configuration", () => {
    expect(
      resolveConfig({
        output: {
          crossOriginLoading: "anonymous",
        },
      }).output,
    ).toEqual({
      client: "dist/client",
      server: "dist/server",
      crossOriginLoading: "anonymous",
    });

    expect(
      resolveConfig({
        output: {
          client: "dist",
          server: ".ev/server",
          crossOriginLoading: "use-credentials",
        },
      }).output,
    ).toEqual({
      client: "dist",
      server: ".ev/server",
      crossOriginLoading: "use-credentials",
    });

    expect(
      resolveConfig({
        output: {
          crossOriginLoading: false,
        },
      }).output,
    ).toEqual({
      client: "dist/client",
      server: "dist/server",
      crossOriginLoading: false,
    });
  });

  it("rejects invalid output declarations", () => {
    expect(() =>
      resolveConfig({
        output: null as never,
      }),
    ).toThrow("[evjs] output must be a config object.");

    expect(() =>
      resolveConfig({
        output: {
          // @ts-expect-error runtime config loading can still produce unknown keys.
          crossOrigin: "anonymous",
        },
      }),
    ).toThrow(
      "[evjs] output.crossOrigin is not supported. Use client, server, or crossOriginLoading.",
    );

    expect(() =>
      resolveConfig({
        output: {
          crossOriginLoading: true as never,
        },
      }),
    ).toThrow(
      '[evjs] output.crossOriginLoading must be false, "anonymous", or "use-credentials".',
    );

    expect(() =>
      resolveConfig({
        output: {
          client: "" as never,
        },
      }),
    ).toThrow("[evjs] output.client must be a non-empty string.");

    expect(() =>
      resolveConfig({
        output: {
          client: "dist",
          server: "dist/",
        },
      }),
    ).toThrow(
      "[evjs] output.client and output.server must point to different directories.",
    );
  });

  it("resolves routing defaults when enabled", () => {
    const resolved = resolveConfig({
      routing: true,
    });

    expect(resolved.routing).toEqual({
      mode: "spa",
      dir: "./src/pages",
      html: "./index.html",
      mount: "#app",
      conventions: {
        layout: true,
      },
      routes: [],
    });
  });

  it("respects routing overrides", () => {
    const resolved = resolveConfig({
      html: "./app.html",
      routing: {
        dir: "./app/pages",
        html: "./shell.html",
        conventions: {
          layout: "./app/ShellLayout.tsx",
        },
        mount: "#root",
      },
    });

    expect(resolved.routing).toEqual({
      mode: "spa",
      dir: "./app/pages",
      html: "./shell.html",
      conventions: {
        layout: "./app/ShellLayout.tsx",
      },
      mount: "#root",
      routes: [],
    });
  });

  it("supports disabling the SPA root layout", () => {
    const resolved = resolveConfig({
      routing: {
        mode: "spa",
        conventions: {
          layout: false,
        },
      },
    });

    expect(resolved.routing).toEqual({
      mode: "spa",
      dir: "./src/pages",
      html: "./index.html",
      mount: "#app",
      conventions: {
        layout: false,
      },
      routes: [],
    });
  });

  it("supports disabling all page routing conventions", () => {
    const resolved = resolveConfig({
      routing: {
        mode: "spa",
        conventions: false,
      },
    });

    expect(resolved.routing).toEqual({
      mode: "spa",
      dir: "./src/pages",
      html: "./index.html",
      mount: "#app",
      routes: [],
    });
  });

  it("rejects routing layout configuration in MPA mode", () => {
    expect(() =>
      resolveConfig({
        routing: {
          mode: "mpa",
          conventions: {
            layout: true,
          },
        },
      }),
    ).toThrow(
      "[evjs] routing.conventions.layout is only supported in SPA mode. MPA pages should import shared shell components directly or use shared HTML templates.",
    );
  });

  it("rejects invalid routing declarations", () => {
    expect(() =>
      resolveConfig({
        // @ts-expect-error runtime config loading can still produce null.
        routing: null,
      }),
    ).toThrow("[evjs] routing must be true, false, or a routing object.");

    expect(() =>
      resolveConfig({
        routing: [] as never,
      }),
    ).toThrow("[evjs] routing must be true, false, or a routing object.");

    expect(() =>
      resolveConfig({
        routing: {
          // @ts-expect-error runtime config loading can still produce invalid strings.
          mode: "nested",
        },
      }),
    ).toThrow('[evjs] routing.mode must be "spa" or "mpa".');

    expect(() =>
      resolveConfig({
        routing: {
          dir: "",
        },
      }),
    ).toThrow("[evjs] routing.dir must be a non-empty string.");

    expect(() =>
      resolveConfig({
        routing: {
          html: "",
        },
      }),
    ).toThrow("[evjs] routing.html must be a non-empty string.");

    expect(() =>
      resolveConfig({
        routing: {
          mount: "",
        },
      }),
    ).toThrow("[evjs] routing.mount must be a non-empty string.");

    expect(() =>
      resolveConfig({
        routing: {
          conventions: null as never,
        },
      }),
    ).toThrow(
      "[evjs] routing.conventions must be true, false, or a routing conventions object.",
    );

    expect(() =>
      resolveConfig({
        routing: {
          conventions: {
            layout: "",
          },
        },
      }),
    ).toThrow("[evjs] routing.conventions.layout must be a non-empty string.");

    expect(() =>
      resolveConfig({
        routing: {
          conventions: {
            layout: 1 as never,
          },
        },
      }),
    ).toThrow(
      "[evjs] routing.conventions.layout must be a boolean or a non-empty string.",
    );

    expect(() =>
      resolveConfig({
        routing: {
          conventions: {
            // @ts-expect-error runtime config loading can still produce unknown keys.
            loading: true,
          },
        },
      }),
    ).toThrow(
      "[evjs] routing.conventions.loading is not supported. Use layout.",
    );

    expect(() =>
      resolveConfig({
        routing: {
          // @ts-expect-error runtime config loading can still produce internal fields.
          entry: "./src/main.tsx",
        },
      }),
    ).toThrow(
      "[evjs] routing.entry is not a public config field. SPA routing creates its own page app entry; use app.entry only for a manually bootstrapped SPA.",
    );

    expect(() =>
      resolveConfig({
        routing: {
          // @ts-expect-error runtime config loading can still produce internal fields.
          routes: [],
        },
      }),
    ).toThrow(
      "[evjs] routing.routes is not a public config field. evjs discovers page routes from routing.dir; use pages for explicit non-conventional page declarations.",
    );

    expect(() =>
      resolveConfig({
        routing: {
          // @ts-expect-error runtime config loading can still produce unknown keys.
          fallback: "index.html",
        },
      }),
    ).toThrow(
      "[evjs] routing.fallback is not supported. Use mode, dir, html, mount, or conventions.",
    );
  });

  it("applies all defaults when called with empty config", () => {
    const resolved = resolveConfig({});
    expect(resolved.entry).toBe("./src/main.tsx");
    expect(resolved.html).toBe("./index.html");
    expect(resolved.dev.proxy).toBeDefined();
  });

  it("respects user overrides for top-level fields", () => {
    const resolved = resolveConfig({
      html: "./public/index.html",
    });
    expect(resolved.entry).toBe("./src/main.tsx");
    expect(resolved.html).toBe("./public/index.html");
  });

  it("respects dev port and https overrides", () => {
    const resolved = resolveConfig({
      dev: { port: 8080, https: true },
    });
    expect(resolved.dev.port).toBe(8080);
    expect(resolved.dev.https).toBe(true);
  });

  it("respects dev https with key/cert object", () => {
    const resolved = resolveConfig({
      dev: { https: { key: "key.pem", cert: "cert.pem" } },
    });
    expect(resolved.dev.https).toEqual({ key: "key.pem", cert: "cert.pem" });
  });

  it("keeps user dev proxy rules before framework proxy rules", () => {
    const resolved = resolveConfig({
      dev: {
        proxy: [
          {
            context: ["/api"],
            target: "http://localhost:4000",
            changeOrigin: true,
            secure: false,
          },
        ],
      },
    });

    expect(resolved.dev.proxy[0]).toEqual({
      context: ["/api"],
      target: "http://localhost:4000",
      changeOrigin: true,
      secure: false,
    });
    expect(resolved.dev.proxy[1]).toEqual({
      context: ["/__evjs/fn", "/__evjs/ppr", "/__evjs/rsc"],
      target: "http://localhost:3001",
      changeOrigin: true,
      secure: false,
    });
  });

  it("rejects invalid dev declarations", () => {
    expect(() =>
      resolveConfig({
        dev: null as never,
      }),
    ).toThrow("[evjs] dev must be a config object.");

    expect(() =>
      resolveConfig({
        dev: [] as never,
      }),
    ).toThrow("[evjs] dev must be a config object.");

    expect(() =>
      resolveConfig({
        dev: {
          // @ts-expect-error runtime config loading can still produce unknown keys.
          host: "0.0.0.0",
        },
      }),
    ).toThrow("[evjs] dev.host is not supported. Use port, https, or proxy.");

    expect(() =>
      resolveConfig({
        dev: {
          port: 0,
        },
      }),
    ).toThrow("[evjs] dev.port must be an integer TCP port from 1 to 65535.");

    expect(() =>
      resolveConfig({
        server: {
          dev: {
            port: 65536,
          },
        },
      }),
    ).toThrow(
      "[evjs] server.dev.port must be an integer TCP port from 1 to 65535.",
    );

    expect(() =>
      resolveConfig({
        dev: {
          https: null as never,
        },
      }),
    ).toThrow("[evjs] dev.https must be an HTTPS config object.");

    expect(() =>
      resolveConfig({
        dev: {
          https: {
            key: "key.pem",
            cert: "cert.pem",
            // @ts-expect-error runtime config loading can still produce unknown keys.
            ca: "ca.pem",
          },
        },
      }),
    ).toThrow("[evjs] dev.https.ca is not supported. Use key and cert.");

    expect(() =>
      resolveConfig({
        dev: {
          // @ts-expect-error runtime config loading can still produce strings.
          port: "3000",
        },
      }),
    ).toThrow("[evjs] dev.port must be an integer TCP port from 1 to 65535.");

    expect(() =>
      resolveConfig({
        dev: {
          // @ts-expect-error runtime config loading can still produce objects.
          proxy: {},
        },
      }),
    ).toThrow("[evjs] dev.proxy must be an array of proxy rules.");

    expect(() =>
      resolveConfig({
        dev: {
          proxy: [null as never],
        },
      }),
    ).toThrow("[evjs] dev.proxy[0] must be a proxy rule object.");

    expect(() =>
      resolveConfig({
        dev: {
          proxy: [[] as never],
        },
      }),
    ).toThrow("[evjs] dev.proxy[0] must be a proxy rule object.");

    expect(() =>
      resolveConfig({
        dev: {
          proxy: [
            {
              context: ["/api"],
              target: "http://localhost:4000",
              // @ts-expect-error runtime config loading can still produce unknown keys.
              rewrite: "^/api",
            },
          ],
        },
      }),
    ).toThrow(
      "[evjs] dev.proxy[0].rewrite is not supported. Use context, target, changeOrigin, or secure.",
    );

    expect(() =>
      resolveConfig({
        dev: {
          proxy: [
            {
              context: [],
              target: "http://localhost:4000",
            },
          ],
        },
      }),
    ).toThrow("[evjs] dev.proxy[0].context must contain at least one path.");

    expect(() =>
      resolveConfig({
        dev: {
          proxy: [
            {
              // @ts-expect-error runtime config loading can still produce strings.
              context: "/api",
              target: "http://localhost:4000",
            },
          ],
        },
      }),
    ).toThrow("[evjs] dev.proxy[0].context must be an array of path patterns.");

    expect(() =>
      resolveConfig({
        dev: {
          proxy: [
            {
              context: ["api"],
              target: "http://localhost:4000",
            },
          ],
        },
      }),
    ).toThrow('[evjs] dev.proxy[0].context pattern "api" must start with "/".');

    expect(() =>
      resolveConfig({
        dev: {
          proxy: [
            {
              context: ["/api path"],
              target: "http://localhost:4000",
            },
          ],
        },
      }),
    ).toThrow(
      '[evjs] dev.proxy[0].context pattern "/api path" must not contain whitespace.',
    );

    expect(() =>
      resolveConfig({
        dev: {
          proxy: [
            {
              context: ["/api?debug=1"],
              target: "http://localhost:4000",
            },
          ],
        },
      }),
    ).toThrow(
      '[evjs] dev.proxy[0].context pattern "/api?debug=1" must not include a query string or hash.',
    );

    expect(() =>
      resolveConfig({
        dev: {
          proxy: [
            {
              context: ["/api#debug"],
              target: "http://localhost:4000",
            },
          ],
        },
      }),
    ).toThrow(
      '[evjs] dev.proxy[0].context pattern "/api#debug" must not include a query string or hash.',
    );

    expect(() =>
      resolveConfig({
        dev: {
          proxy: [
            {
              context: ["/api", "/api"],
              target: "http://localhost:4000",
            },
          ],
        },
      }),
    ).toThrow(
      '[evjs] dev.proxy[0].context must not contain duplicate pattern "/api".',
    );

    expect(() =>
      resolveConfig({
        dev: {
          proxy: [
            {
              context: ["/api"],
              target: "",
            },
          ],
        },
      }),
    ).toThrow("[evjs] dev.proxy[0].target must be a non-empty string.");

    expect(() =>
      resolveConfig({
        dev: {
          proxy: [
            {
              context: ["/api"],
              target: "localhost:4000",
            },
          ],
        },
      }),
    ).toThrow("[evjs] dev.proxy[0].target must be an absolute http(s) URL.");

    expect(() =>
      resolveConfig({
        dev: {
          proxy: [
            {
              context: ["/api"],
              target: "ws://localhost:4000",
            },
          ],
        },
      }),
    ).toThrow("[evjs] dev.proxy[0].target must be an absolute http(s) URL.");

    expect(() =>
      resolveConfig({
        dev: {
          proxy: [
            {
              context: ["/api"],
              target: " http://localhost:4000 ",
            },
          ],
        },
      }),
    ).toThrow(
      "[evjs] dev.proxy[0].target must not contain leading or trailing whitespace.",
    );

    expect(() =>
      resolveConfig({
        dev: {
          proxy: [
            {
              context: ["/api"],
              target: "http://localhost:4000",
              // @ts-expect-error runtime config loading can still produce strings.
              secure: "false",
            },
          ],
        },
      }),
    ).toThrow("[evjs] dev.proxy[0].secure must be a boolean when provided.");
  });

  it("keeps framework proxy rules with user dev proxy rules", () => {
    const resolved = resolveConfig({
      dev: {
        proxy: [
          {
            context: ["/api"],
            target: "http://localhost:4000",
            changeOrigin: true,
            secure: false,
          },
        ],
      },
    });

    expect(resolved.dev.proxy).toEqual([
      {
        context: ["/api"],
        target: "http://localhost:4000",
        changeOrigin: true,
        secure: false,
      },
      {
        context: ["/__evjs/fn", "/__evjs/ppr", "/__evjs/rsc"],
        target: "http://localhost:3001",
        changeOrigin: true,
        secure: false,
      },
    ]);
  });

  it("respects server overrides", () => {
    const resolved = resolveConfig({
      server: {
        basePath: "/api",
        dev: { port: 4000 },
      },
    });
    expect(resolved.server.runtime.fn).toBe("/api/fn");
    expect(resolved.server.runtime.ppr).toBe("/api/ppr");
    expect(resolved.server.runtime.fn).toBe("/api/fn");
    expect(resolved.server.dev.port).toBe(4000);
  });

  it("proxies framework paths derived from basePath in dev", () => {
    const resolved = resolveConfig({
      server: {
        basePath: "/api",
        dev: { port: 4001 },
      },
    });

    expect(resolved.dev.proxy).toContainEqual({
      context: ["/api/fn", "/api/ppr", "/api/rsc"],
      target: "http://localhost:4001",
      changeOrigin: true,
      secure: false,
    });
  });

  it("uses a pathname proxy context for the default framework endpoint", () => {
    const resolved = resolveConfig();

    expect(resolved.server.runtime.fn).toBe("/__evjs/fn");
    expect(resolved.dev.proxy).toContainEqual({
      context: ["/__evjs/fn", "/__evjs/ppr", "/__evjs/rsc"],
      target: "http://localhost:3001",
      changeOrigin: true,
      secure: false,
    });
  });

  it("derives framework server paths from basePath", () => {
    const resolved = resolveConfig({
      server: {
        basePath: "/_ev",
      },
      transport: {
        baseUrl: "https://api.example.com",
      },
    });

    expect(resolved.server.runtime).toEqual({
      basePath: "/_ev",
      fn: "/_ev/fn",
      ppr: "/_ev/ppr",
      rsc: "/_ev/rsc",
    });
    expect(resolved.transport.baseUrl).toBe("https://api.example.com");
  });

  it("derives the RSC endpoint from the framework server base path", () => {
    const resolved = resolveConfig({
      server: {
        basePath: "/_ev",
        rsc: true,
      },
    });

    expect(resolved.server.runtime).toEqual({
      basePath: "/_ev",
      fn: "/_ev/fn",
      ppr: "/_ev/ppr",
      rsc: "/_ev/rsc",
    });
    expect(resolved.server.rsc).toEqual({
      endpoint: "/_ev/rsc",
    });
    expect(resolved.dev.proxy).toContainEqual({
      context: ["/_ev/fn", "/_ev/ppr", "/_ev/rsc"],
      target: "http://localhost:3001",
      changeOrigin: true,
      secure: false,
    });
  });

  it("respects explicit RSC endpoint override", () => {
    const resolved = resolveConfig({
      server: {
        rsc: {
          endpoint: "/flight",
        },
      },
    });

    expect(resolved.server.runtime.rsc).toBe("/flight");
    expect(resolved.server.rsc?.endpoint).toBe("/flight");
  });

  it("enables the RSC endpoint with the framework server runtime", () => {
    const resolved = resolveConfig({
      server: {
        basePath: "/_ev",
      },
    });

    expect(resolved.server.runtime.rsc).toBe("/_ev/rsc");
    expect(resolved.server.rsc?.endpoint).toBe("/_ev/rsc");
    expect(resolved.dev.proxy).toContainEqual({
      context: ["/_ev/fn", "/_ev/ppr", "/_ev/rsc"],
      target: "http://localhost:3001",
      changeOrigin: true,
      secure: false,
    });
  });

  it("resolves server file routing configuration", () => {
    expect(
      resolveConfig({
        server: {
          routing: true,
        },
      }).server.routing,
    ).toEqual({
      dir: CONFIG_DEFAULTS.serverRoutingDir,
      routes: [],
    });

    expect(
      resolveConfig({
        server: {
          routing: {
            dir: "./src/custom-routes",
          },
        },
      }).server.routing,
    ).toEqual({
      dir: "./src/custom-routes",
      routes: [],
    });

    expect(
      resolveConfig({
        server: {
          routing: false,
        },
      }).server.routing,
    ).toBeUndefined();
  });

  it("resolves server convention configuration", () => {
    expect(
      resolveConfig({
        server: {
          routing: true,
        },
      }).server.conventions,
    ).toEqual({
      middleware: true,
      globalMiddlewares: [],
      routeMiddlewares: [],
    });

    expect(
      resolveConfig({
        server: {
          conventions: true,
        },
      }).server.conventions,
    ).toEqual({
      middleware: true,
      globalMiddlewares: [],
      routeMiddlewares: [],
    });

    expect(
      resolveConfig({
        server: {
          routing: true,
          conventions: false,
        },
      }).server.conventions,
    ).toBeUndefined();

    expect(
      resolveConfig({
        server: {
          routing: true,
          conventions: {
            middleware: false,
          },
        },
      }).server.conventions,
    ).toBeUndefined();

    expect(
      resolveConfig({
        server: {
          conventions: true,
        },
      }).server.conventions,
    ).toEqual({
      middleware: true,
      globalMiddlewares: [],
      routeMiddlewares: [],
    });
  });

  it("rejects invalid server and transport declarations", () => {
    expect(() =>
      resolveConfig({
        server: null as never,
      }),
    ).toThrow("[evjs] server must be a config object.");

    expect(() =>
      resolveConfig({
        server: [] as never,
      }),
    ).toThrow("[evjs] server must be a config object.");

    expect(() =>
      resolveConfig({
        server: {
          // @ts-expect-error runtime config loading can still produce internal fields.
          functions: { endpoint: "/api/rpc" },
        },
      }),
    ).toThrow(
      "[evjs] server.functions is not a public config field. Server function, PPR, and RSC endpoints are derived from server.basePath.",
    );

    expect(() =>
      resolveConfig({
        server: {
          // @ts-expect-error runtime config loading can still produce resolved metadata.
          runtime: { fn: "/api/fn" },
        },
      }),
    ).toThrow(
      "[evjs] server.runtime is resolved framework metadata and cannot be configured. Use server.basePath to change framework endpoint paths.",
    );

    expect(() =>
      resolveConfig({
        server: {
          // @ts-expect-error runtime config loading can still produce resolved metadata.
          functionRuntime: { endpoint: "/api/fn" },
        },
      }),
    ).toThrow(
      "[evjs] server.functionRuntime is internal build metadata and cannot be configured. Use server.basePath to change framework endpoint paths.",
    );

    expect(() =>
      resolveConfig({
        server: {
          // @ts-expect-error runtime config loading can still produce unknown keys.
          endpoint: "/api/fn",
        },
      }),
    ).toThrow(
      "[evjs] server.endpoint is not supported. Use routing, conventions, basePath, rsc, or dev.",
    );

    expect(() =>
      resolveConfig({
        server: {
          // @ts-expect-error runtime config loading can still produce unknown keys.
          entry: "./src/server.ts",
        },
      }),
    ).toThrow(
      "[evjs] server.entry is not supported. Use server.routing file conventions under src/apis instead.",
    );

    expect(() =>
      resolveConfig({
        server: {
          routing: null as never,
        },
      }),
    ).toThrow(
      "[evjs] server.routing must be true, false, or a server routing object.",
    );

    expect(() =>
      resolveConfig({
        server: {
          routing: {
            // @ts-expect-error runtime config loading can still produce unknown keys.
            prefix: "/api",
          },
        },
      }),
    ).toThrow("[evjs] server.routing.prefix is not supported. Use dir.");

    expect(() =>
      resolveConfig({
        server: {
          routing: {
            dir: "",
          },
        },
      }),
    ).toThrow("[evjs] server.routing.dir must be a non-empty string.");

    expect(() =>
      resolveConfig({
        server: {
          conventions: null as never,
        },
      }),
    ).toThrow(
      "[evjs] server.conventions must be true, false, or a server conventions object.",
    );

    expect(() =>
      resolveConfig({
        server: {
          conventions: {
            // @ts-expect-error runtime config loading can still produce unknown keys.
            errors: true,
          },
        },
      }),
    ).toThrow(
      "[evjs] server.conventions.errors is not supported. Use middleware.",
    );

    expect(() =>
      resolveConfig({
        server: {
          conventions: {
            middleware: "yes" as never,
          },
        },
      }),
    ).toThrow("[evjs] server.conventions.middleware must be a boolean.");

    expect(() =>
      resolveConfig({
        server: {
          basePath: "",
        },
      }),
    ).toThrow("[evjs] server.basePath must be a non-empty string.");

    expect(() =>
      resolveConfig({
        server: {
          basePath: "api",
        },
      }),
    ).toThrow('[evjs] server.basePath must start with "/".');

    expect(() =>
      resolveConfig({
        server: {
          basePath: "/api path",
        },
      }),
    ).toThrow("[evjs] server.basePath must not contain whitespace.");

    expect(() =>
      resolveConfig({
        server: {
          basePath: "/api?debug=1",
        },
      }),
    ).toThrow(
      "[evjs] server.basePath must not include a query string or hash.",
    );

    expect(() =>
      resolveConfig({
        server: {
          basePath: "/api#debug",
        },
      }),
    ).toThrow(
      "[evjs] server.basePath must not include a query string or hash.",
    );

    expect(() =>
      resolveConfig({
        server: {
          rsc: null as never,
        },
      }),
    ).toThrow("[evjs] server.rsc must be a server RSC object.");

    expect(() =>
      resolveConfig({
        server: {
          rsc: [] as never,
        },
      }),
    ).toThrow("[evjs] server.rsc must be a server RSC object.");

    expect(() =>
      resolveConfig({
        server: {
          rsc: {
            // @ts-expect-error runtime config loading can still produce unknown keys.
            path: "/flight",
          },
        },
      }),
    ).toThrow("[evjs] server.rsc.path is not supported. Use endpoint.");

    expect(() =>
      resolveConfig({
        server: {
          rsc: {
            endpoint: "",
          },
        },
      }),
    ).toThrow("[evjs] server.rsc.endpoint must be a non-empty string.");

    expect(() =>
      resolveConfig({
        server: {
          rsc: {
            endpoint: "flight",
          },
        },
      }),
    ).toThrow('[evjs] server.rsc.endpoint must start with "/".');

    expect(() =>
      resolveConfig({
        server: {
          rsc: {
            endpoint: "/flight debug",
          },
        },
      }),
    ).toThrow("[evjs] server.rsc.endpoint must not contain whitespace.");

    expect(() =>
      resolveConfig({
        server: {
          rsc: {
            endpoint: "/flight?debug=1",
          },
        },
      }),
    ).toThrow(
      "[evjs] server.rsc.endpoint must not include a query string or hash.",
    );

    expect(() =>
      resolveConfig({
        server: {
          rsc: {
            endpoint: "/flight#debug",
          },
        },
      }),
    ).toThrow(
      "[evjs] server.rsc.endpoint must not include a query string or hash.",
    );

    expect(() =>
      resolveConfig({
        dev: {
          https: { key: "", cert: "cert.pem" },
        },
      }),
    ).toThrow("[evjs] dev.https.key must be a non-empty string.");

    expect(() =>
      resolveConfig({
        server: {
          dev: null as never,
        },
      }),
    ).toThrow("[evjs] server.dev must be a config object.");

    expect(() =>
      resolveConfig({
        server: {
          dev: {
            // @ts-expect-error runtime config loading can still produce unknown keys.
            host: "127.0.0.1",
          },
        },
      }),
    ).toThrow("[evjs] server.dev.host is not supported. Use port or https.");

    expect(() =>
      resolveConfig({
        server: {
          dev: {
            https: [] as never,
          },
        },
      }),
    ).toThrow("[evjs] server.dev.https must be an HTTPS config object.");

    expect(() =>
      resolveConfig({
        server: {
          dev: {
            https: {
              key: "key.pem",
              cert: "cert.pem",
              // @ts-expect-error runtime config loading can still produce unknown keys.
              ca: "ca.pem",
            },
          },
        },
      }),
    ).toThrow("[evjs] server.dev.https.ca is not supported. Use key and cert.");

    expect(() =>
      resolveConfig({
        server: {
          dev: {
            https: { key: "key.pem", cert: "" },
          },
        },
      }),
    ).toThrow("[evjs] server.dev.https.cert must be a non-empty string.");

    expect(() =>
      resolveConfig({
        transport: null as never,
      }),
    ).toThrow("[evjs] transport must be a config object.");

    expect(() =>
      resolveConfig({
        transport: [] as never,
      }),
    ).toThrow("[evjs] transport must be a config object.");

    expect(() =>
      resolveConfig({
        transport: {
          // @ts-expect-error runtime config loading can still produce unknown keys.
          origin: "https://api.example.com",
        },
      }),
    ).toThrow("[evjs] transport.origin is not supported. Use baseUrl.");

    expect(() =>
      resolveConfig({
        transport: {
          baseUrl: "",
        },
      }),
    ).toThrow("[evjs] transport.baseUrl must be a non-empty string.");

    expect(() =>
      resolveConfig({
        transport: {
          baseUrl: "/api",
        },
      }),
    ).toThrow("[evjs] transport.baseUrl must be an absolute http(s) URL.");

    expect(() =>
      resolveConfig({
        transport: {
          baseUrl: "ws://api.example.com",
        },
      }),
    ).toThrow("[evjs] transport.baseUrl must be an absolute http(s) URL.");

    expect(() =>
      resolveConfig({
        transport: {
          baseUrl: " https://api.example.com ",
        },
      }),
    ).toThrow(
      "[evjs] transport.baseUrl must not contain leading or trailing whitespace.",
    );
  });

  it("resolves app declaration sources", () => {
    const resolved = resolveConfig({
      app: {
        entry: "./src/admin/main.tsx",
        html: "./src/admin/index.html",
      },
    });

    expect(resolved.apps).toEqual({
      default: {
        entry: "./src/admin/main.tsx",
        html: "./src/admin/index.html",
        mount: undefined,
      },
    });
  });

  it("rejects invalid single app declarations", () => {
    expect(() =>
      resolveConfig({
        app: "",
      }),
    ).toThrow("[evjs] app must be a non-empty string.");

    expect(() =>
      resolveConfig({
        html: "",
      }),
    ).toThrow("[evjs] html must be a non-empty string.");

    expect(() =>
      resolveConfig({
        app: "",
      }),
    ).toThrow("[evjs] app must be a non-empty string.");

    expect(() =>
      resolveConfig({
        // @ts-expect-error runtime config loading can still produce null.
        app: null,
      }),
    ).toThrow("[evjs] app must be a string module path or an app object.");

    expect(() =>
      resolveConfig({
        app: [] as never,
      }),
    ).toThrow("[evjs] app must be a string module path or an app object.");

    expect(() =>
      resolveConfig({
        app: {
          entry: "./src/main.tsx",
          // @ts-expect-error runtime config loading can still produce unknown keys.
          route: "/admin",
        },
      }),
    ).toThrow(
      "[evjs] app.route is not supported. Use source, entry, html, or mount.",
    );

    expect(() =>
      resolveConfig({
        app: {
          source: "",
        },
      }),
    ).toThrow("[evjs] app.source must be a non-empty string.");

    expect(() =>
      resolveConfig({
        app: {
          entry: "",
        },
      }),
    ).toThrow("[evjs] app.entry must be a non-empty string.");

    expect(() =>
      resolveConfig({
        app: {
          source: "./src/app.tsx",
          entry: "./src/main.tsx",
        },
      }),
    ).toThrow("[evjs] app must specify exactly one of source or entry.");

    expect(() =>
      resolveConfig({
        app: {
          entry: "./src/main.tsx",
          html: "",
        },
      }),
    ).toThrow("[evjs] app.html must be a non-empty string.");

    expect(() =>
      resolveConfig({
        app: {
          entry: "./src/main.tsx",
          mount: "",
        },
      }),
    ).toThrow("[evjs] app.mount must be a non-empty string.");
  });

  it("respects server dev https override", () => {
    const resolved = resolveConfig({
      server: {
        dev: { https: { key: "server.key", cert: "server.cert" } },
      },
    });
    expect(resolved.server.dev.https).toEqual({
      key: "server.key",
      cert: "server.cert",
    });
  });

  it("passes bundler adapter through", () => {
    const mockAdapter = {
      name: "test",
      build: async () => {},
      dev: async () => {},
    };
    const resolved = resolveConfig({
      bundler: mockAdapter as unknown as BundlerAdapter<unknown>,
    });
    expect(resolved.bundler).toBe(mockAdapter);
  });

  it("rejects invalid bundler adapter declarations", () => {
    expect(() =>
      resolveConfig({
        bundler: null as never,
      }),
    ).toThrow("[evjs] bundler must be a bundler adapter object.");

    expect(() =>
      resolveConfig({
        bundler: [] as never,
      }),
    ).toThrow("[evjs] bundler must be a bundler adapter object.");

    expect(() =>
      resolveConfig({
        bundler: {
          name: "",
          build: async () => {},
          dev: async () => {},
        } as never,
      }),
    ).toThrow("[evjs] bundler.name must be a non-empty string.");

    const bundlerWithUnknownKey = {
      name: "custom",
      build: async () => ({}),
      dev: async () => undefined,
      serve: async () => {},
    } satisfies BundlerAdapter & { serve(): Promise<void> };

    expect(() =>
      resolveConfig({
        bundler: bundlerWithUnknownKey,
      }),
    ).toThrow(
      "[evjs] bundler.serve is not supported. Use name, build, or dev.",
    );

    expect(() =>
      resolveConfig({
        bundler: {
          name: " custom ",
          build: async () => {},
          dev: async () => {},
        } as never,
      }),
    ).toThrow(
      "[evjs] bundler.name must not contain leading or trailing whitespace.",
    );

    expect(() =>
      resolveConfig({
        bundler: {
          name: "custom",
          dev: async () => {},
        } as never,
      }),
    ).toThrow("[evjs] bundler.build must be a function.");

    expect(() =>
      resolveConfig({
        bundler: {
          name: "custom",
          build: async () => {},
          dev: "run" as never,
        } as never,
      }),
    ).toThrow("[evjs] bundler.dev must be a function.");
  });

  it("passes plugins through", () => {
    const plugin = { name: "test-plugin" };
    const resolved = resolveConfig({ plugins: [plugin] });
    expect(resolved.plugins).toEqual([plugin]);
  });

  it("accepts plugin object metadata", () => {
    const resolved = resolveConfig({
      plugins: [
        {
          name: "test-plugin",
          description: "custom plugin metadata",
        } as never,
      ],
    });

    expect(resolved.plugins).toEqual([
      {
        name: "test-plugin",
      },
    ]);
  });

  it("rejects invalid plugin declarations", () => {
    expect(() =>
      resolveConfig({
        plugins: {} as never,
      }),
    ).toThrow("[evjs] plugins must be an array of plugin objects.");

    expect(() =>
      resolveConfig({
        plugins: [null as never],
      }),
    ).toThrow("[evjs] plugins[0] must be a plugin object.");

    expect(() =>
      resolveConfig({
        plugins: [{ name: "" }],
      }),
    ).toThrow("[evjs] plugins[0].name must be a non-empty string.");

    expect(() =>
      resolveConfig({
        plugins: [{ name: " build-timer " }],
      }),
    ).toThrow(
      "[evjs] plugins[0].name must not contain leading or trailing whitespace.",
    );

    expect(() =>
      resolveConfig({
        plugins: [{ name: "build-timer", dependencies: "logger" as never }],
      }),
    ).toThrow(
      "[evjs] plugins[0].dependencies must be an array of plugin names.",
    );

    expect(() =>
      resolveConfig({
        plugins: [
          {
            name: "build-timer",
            dependencies: ["logger", "logger"],
          },
        ],
      }),
    ).toThrow(
      '[evjs] plugins[0].dependencies must not contain duplicate plugin name "logger".',
    );

    expect(() =>
      resolveConfig({
        plugins: [
          {
            name: "build-timer",
            optionalDependencies: [" logger "],
          },
        ],
      }),
    ).toThrow(
      "[evjs] plugins[0].optionalDependencies[0] must not contain leading or trailing whitespace.",
    );

    expect(() =>
      resolveConfig({
        plugins: [
          {
            name: "build-timer",
            optionalDependencies: ["logger", "logger"],
          },
        ],
      }),
    ).toThrow(
      '[evjs] plugins[0].optionalDependencies must not contain duplicate plugin name "logger".',
    );

    expect(() =>
      resolveConfig({
        plugins: [
          {
            name: "build-timer",
            dependencies: ["logger"],
            optionalDependencies: ["logger"],
          },
        ],
      }),
    ).toThrow(
      '[evjs] plugins[0].optionalDependencies must not repeat required dependency "logger".',
    );

    expect(() =>
      resolveConfig({
        plugins: [{ name: "build-timer", enforce: "early" as never }],
      }),
    ).toThrow('[evjs] plugins[0].enforce must be "pre", "normal", or "post".');

    expect(() =>
      resolveConfig({
        plugins: [{ name: "build-timer", config: "configure" as never }],
      }),
    ).toThrow("[evjs] plugins[0].config must be a function.");

    expect(() =>
      resolveConfig({
        plugins: [{ name: "build-timer", setup: "setup" as never }],
      }),
    ).toThrow("[evjs] plugins[0].setup must be a function.");
  });

  it("does not share state between calls", () => {
    const a = resolveConfig({ html: "./a.html" });
    const b = resolveConfig({ html: "./b.html" });
    expect(a.html).toBe("./a.html");
    expect(b.html).toBe("./b.html");
  });

  it("resolves MPA page string shorthand as component modules", () => {
    const resolved = resolveConfig({
      pages: {
        home: "./src/Home.tsx",
        campaign: "./src/Campaign.tsx",
      },
    });

    expect(resolved.pages).toEqual({
      home: {
        entry: undefined,
        path: undefined,
        component: "./src/Home.tsx",
        app: undefined,
        html: "./index.html",
        mount: undefined,
      },
      campaign: {
        entry: undefined,
        path: undefined,
        component: "./src/Campaign.tsx",
        app: undefined,
        html: "./index.html",
        mount: undefined,
      },
    });
  });

  it("resolves MPA pages from entry objects", () => {
    const resolved = resolveConfig({
      html: "./app.html",
      pages: {
        home: { entry: "./src/home/main.tsx" },
        campaign: {
          entry: "./src/campaign/main.tsx",
          html: "./campaign.html",
        },
      },
    });

    expect(resolved.pages).toEqual({
      home: {
        entry: "./src/home/main.tsx",
        path: undefined,
        component: undefined,
        app: undefined,
        html: "./app.html",
        mount: undefined,
      },
      campaign: {
        entry: "./src/campaign/main.tsx",
        path: undefined,
        component: undefined,
        app: undefined,
        html: "./campaign.html",
        mount: undefined,
      },
    });
  });

  it("resolves framework-managed component pages", () => {
    const resolved = resolveConfig({
      pages: {
        home: {
          path: "/home",
          component: "./src/home/Page.tsx",
          mount: "#root",
        },
      },
    });

    expect(resolved.pages).toEqual({
      home: {
        path: "/home",
        entry: undefined,
        component: "./src/home/Page.tsx",
        app: undefined,
        html: "./index.html",
        mount: "#root",
      },
    });
  });

  it("resolves explicit component page rendering metadata", () => {
    const resolved = resolveConfig({
      pages: {
        campaign: {
          path: "/campaign",
          component: "./src/campaign/Page.tsx",
          render: "ssr",
          hydrate: "none",
          prerender: {
            partial: true,
            delivery: "stream",
            revalidate: 60,
          },
        },
        insights: {
          path: "/insights",
          component: "./src/insights/Page.tsx",
          render: "ssr",
          hydrate: "none",
          rsc: true,
        },
      },
    });

    expect(resolved.pages?.campaign).toMatchObject({
      path: "/campaign",
      component: "./src/campaign/Page.tsx",
      render: "ssr",
      hydrate: "none",
      prerender: {
        partial: true,
        delivery: "stream",
        revalidate: 60,
      },
      ppr: {
        delivery: "stream",
        revalidate: 60,
      },
    });
    expect(resolved.pages?.insights).toMatchObject({
      path: "/insights",
      component: "./src/insights/Page.tsx",
      render: "ssr",
      hydrate: "none",
      componentModel: "rsc",
    });
  });

  it("rejects duplicate explicit page paths", () => {
    expect(() =>
      resolveConfig({
        pages: {
          home: {
            path: "/dashboard",
            component: "./src/home/Page.tsx",
          },
          dashboard: {
            path: "/dashboard",
            component: "./src/dashboard/Page.tsx",
          },
        },
      }),
    ).toThrow(
      '[evjs] pages.dashboard.path duplicates pages.home.path "/dashboard". Page paths must be unique.',
    );
  });

  it("rejects duplicate explicit page path shapes", () => {
    expect(() =>
      resolveConfig({
        pages: {
          userById: {
            path: "/users/:id",
            component: "./src/users/ById.tsx",
          },
          userByUserId: {
            path: "/users/:userId",
            component: "./src/users/ByUserId.tsx",
          },
        },
      }),
    ).toThrow(
      '[evjs] pages.userByUserId.path "/users/:userId" has the same route shape as pages.userById.path "/users/:id". Use one dynamic param name for each URL shape.',
    );

    expect(() =>
      resolveConfig({
        pages: {
          orderById: {
            path: "/orders/$id",
            component: "./src/orders/ById.tsx",
          },
          orderByOrderId: {
            path: "/orders/$orderId",
            component: "./src/orders/ByOrderId.tsx",
          },
        },
      }),
    ).toThrow(
      '[evjs] pages.orderByOrderId.path "/orders/$orderId" has the same route shape as pages.orderById.path "/orders/$id". Use one dynamic param name for each URL shape.',
    );
  });

  it("rejects invalid explicit page rendering combinations", () => {
    expect(() =>
      resolveConfig({
        pages: {
          home: {
            component: "./src/Home.tsx",
            prerender: {
              revalidate: 60,
            },
          },
        },
      }),
    ).toThrow(
      '[evjs] pages.home uses full prerendering and must declare render: "ssg" or "ssr".',
    );

    expect(() =>
      resolveConfig({
        pages: {
          rsc: {
            component: "./src/Rsc.tsx",
            rsc: true,
          },
        },
      }),
    ).toThrow('[evjs] pages.rsc uses RSC and must declare render: "ssr".');

    expect(() =>
      resolveConfig({
        pages: {
          rsc: {
            component: "./src/Rsc.tsx",
            render: "ssr",
            hydrate: "load",
            rsc: true,
          },
        },
      }),
    ).toThrow(
      '[evjs] pages.rsc uses RSC and must omit hydrate or declare hydrate: "none".',
    );

    expect(() =>
      resolveConfig({
        pages: {
          campaign: {
            component: "./src/Campaign.tsx",
            render: "ssg",
            prerender: {
              partial: true,
            },
          },
        },
      }),
    ).toThrow(
      '[evjs] pages.campaign uses partial prerendering and must declare render: "ssr".',
    );

    expect(() =>
      resolveConfig({
        pages: {
          campaign: {
            component: "./src/Campaign.tsx",
            render: "ssr",
            rsc: true,
            prerender: {
              partial: true,
            },
          },
        },
      }),
    ).toThrow(
      "[evjs] pages.campaign combines RSC and partial prerendering, which is not supported yet. Choose either rsc: true or prerender: { partial: true }, or split them into separate page routes.",
    );
  });

  it("rejects pages with more than one module contract", () => {
    expect(() =>
      resolveConfig({
        pages: {
          home: {
            entry: "./src/home/main.tsx",
            component: "./src/home/Page.tsx",
          },
        },
      }),
    ).toThrow(
      'Page "home" must specify exactly one of entry, component, or app',
    );
  });

  it("rejects invalid explicit page declarations", () => {
    expect(() =>
      resolveConfig({
        pages: [] as never,
      }),
    ).toThrow("[evjs] pages must be an object map.");

    expect(() =>
      resolveConfig({
        pages: {
          "": "./src/Home.tsx",
        },
      }),
    ).toThrow("[evjs] pages must not contain empty keys.");

    expect(() =>
      resolveConfig({
        pages: {
          "admin/settings": "./src/AdminSettings.tsx",
        },
      }),
    ).toThrow(
      '[evjs] pages key "admin/settings" must contain only letters, numbers, underscores, or hyphens.',
    );

    expect(() =>
      resolveConfig({
        pages: {
          // @ts-expect-error runtime config loading can still produce null.
          home: null,
        },
      }),
    ).toThrow(
      "[evjs] pages.home must be a string module path or a page object.",
    );

    expect(() =>
      resolveConfig({
        pages: {
          home: "",
        },
      }),
    ).toThrow("[evjs] pages.home.component must be a non-empty string.");

    expect(() =>
      resolveConfig({
        pages: {
          home: {
            component: "./src/Home.tsx",
            // @ts-expect-error runtime config loading can still produce unknown keys.
            loader: "./src/home.loader.ts",
          },
        },
      }),
    ).toThrow(
      "[evjs] pages.home.loader is not supported. Use path, entry, component, app, html, mount, render, hydrate, prerender, or rsc.",
    );

    expect(() =>
      resolveConfig({
        pages: {
          home: {
            entry: "",
          },
        },
      }),
    ).toThrow("[evjs] pages.home.entry must be a non-empty string.");

    expect(() =>
      resolveConfig({
        pages: {
          home: {
            component: "./src/Home.tsx",
            path: "home",
          },
        },
      }),
    ).toThrow('[evjs] pages.home.path must start with "/".');

    expect(() =>
      resolveConfig({
        pages: {
          home: {
            component: "./src/Home.tsx",
            path: "/home page",
          },
        },
      }),
    ).toThrow("[evjs] pages.home.path must not contain whitespace.");

    expect(() =>
      resolveConfig({
        pages: {
          home: {
            component: "./src/Home.tsx",
            path: "/home?tab=latest",
          },
        },
      }),
    ).toThrow(
      "[evjs] pages.home.path must not include a query string or hash.",
    );

    expect(() =>
      resolveConfig({
        pages: {
          home: {
            component: "./src/Home.tsx",
            path: "/home#main",
          },
        },
      }),
    ).toThrow(
      "[evjs] pages.home.path must not include a query string or hash.",
    );

    expect(() =>
      resolveConfig({
        pages: {
          home: {
            component: "./src/Home.tsx",
            path: "/session/:__proto__",
          },
        },
      }),
    ).toThrow(
      '[evjs] pages.home.path uses reserved dynamic param name "__proto__" in segment ":__proto__". Use a safe application-specific name.',
    );

    expect(() =>
      resolveConfig({
        pages: {
          home: {
            component: "./src/Home.tsx",
            path: "/docs/:_splat",
          },
        },
      }),
    ).toThrow(
      '[evjs] pages.home.path uses reserved dynamic param name "_splat" in segment ":_splat". Use a safe application-specific name.',
    );

    expect(() =>
      resolveConfig({
        pages: {
          home: {
            component: "./src/Home.tsx",
            path: "/docs/*/edit/*",
          },
        },
      }),
    ).toThrow(
      '[evjs] pages.home.path contains more than one wildcard segment "*". Use at most one wildcard segment in a route path.',
    );

    expect(() =>
      resolveConfig({
        pages: {
          home: {
            component: "./src/Home.tsx",
            path: "/session/:",
          },
        },
      }),
    ).toThrow(
      '[evjs] pages.home.path contains dynamic segment ":" without a param name.',
    );

    expect(() =>
      resolveConfig({
        pages: {
          home: {
            component: "./src/Home.tsx",
            path: "/teams/:teamId/users/:teamId",
          },
        },
      }),
    ).toThrow(
      '[evjs] pages.home.path uses duplicate dynamic param name "teamId" in segment ":teamId". Use unique param names within one route path.',
    );

    expect(() =>
      resolveConfig({
        pages: {
          home: {
            app: "./src/HomeApp.ts",
            html: "",
          },
        },
      }),
    ).toThrow("[evjs] pages.home.html must be a non-empty string.");

    expect(() =>
      resolveConfig({
        pages: {
          home: {
            component: "./src/Home.tsx",
            mount: "",
          },
        },
      }),
    ).toThrow("[evjs] pages.home.mount must be a non-empty string.");

    expect(() =>
      resolveConfig({
        pages: {
          home: {
            entry: "./src/home.tsx",
            render: "ssr" as never,
          },
        },
      }),
    ).toThrow("[evjs] pages.home.render is only supported on component pages.");

    expect(() =>
      resolveConfig({
        pages: {
          home: {
            component: "./src/Home.tsx",
            render: "ppr" as never,
          },
        },
      }),
    ).toThrow(
      '[evjs] pages.home.render mode "ppr" is not supported. Use render: "ssr" with prerender: { partial: true }.',
    );

    expect(() =>
      resolveConfig({
        pages: {
          home: {
            component: "./src/Home.tsx",
            hydrate: "soon" as never,
          },
        },
      }),
    ).toThrow(
      '[evjs] pages.home.hydrate must be "none", "load", "visible", or "idle".',
    );

    expect(() =>
      resolveConfig({
        pages: {
          home: {
            component: "./src/Home.tsx",
            prerender: {} as never,
          },
        },
      }),
    ).toThrow(
      "[evjs] pages.home.prerender object must declare partial, delivery, or revalidate.",
    );

    expect(() =>
      resolveConfig({
        pages: {
          home: {
            component: "./src/Home.tsx",
            prerender: {
              revalidate: 0,
            },
          },
        },
      }),
    ).toThrow(
      "[evjs] pages.home.prerender.revalidate must be a positive integer number of seconds or false.",
    );

    expect(() =>
      resolveConfig({
        pages: {
          home: {
            component: "./src/Home.tsx",
            prerender: {
              revalidate: 1.5,
            },
          },
        },
      }),
    ).toThrow(
      "[evjs] pages.home.prerender.revalidate must be a positive integer number of seconds or false.",
    );

    expect(() =>
      resolveConfig({
        pages: {
          home: {
            component: "./src/Home.tsx",
            rsc: "yes" as never,
          },
        },
      }),
    ).toThrow("[evjs] pages.home.rsc must be a boolean when provided.");
  });
});
