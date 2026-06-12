import type { BuildOutput } from "@evjs/shared/manifest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startPageRuntime } from "../src/page.js";
import {
  __resetForTesting,
  callServer,
  initTransport,
} from "../src/transport.js";

afterEach(() => {
  __resetForTesting();
  vi.unstubAllGlobals();
});

describe("startPageRuntime", () => {
  it("boots the shell from framework HTML attributes and an embedded manifest", async () => {
    const events: string[] = [];
    const mountPoint = {} as Element;
    const manifest = createManifest();
    const document = createDocument({
      manifest,
      mountPoint,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
        "data-evjs-build": "test",
      },
    });

    const shell = await startPageRuntime({
      document,
      async loadModule(href, ctx) {
        events.push(`load:${href}`);
        return {
          hydrate(target) {
            events.push(
              `hydrate:${ctx.kind}:${ctx.id}:${target === mountPoint}`,
            );
          },
        };
      },
    });

    await shell.dispose();

    expect(events).toEqual(["load:/home.js", "hydrate:page:home:true"]);
  });

  it("fetches the manifest when it is not embedded", async () => {
    const events: string[] = [];
    const mountPoint = {} as Element;
    const document = createDocument({
      mountPoint,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
        "data-evjs-manifest": "/assets/manifest.json",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(createManifest())),
    );

    await startPageRuntime({
      document,
      async loadModule(href) {
        events.push(`load:${href}`);
        return {
          mount() {
            events.push("mount");
          },
        };
      },
    });

    expect(fetch).toHaveBeenCalledWith("/assets/manifest.json");
    expect(events).toEqual(["load:/home.js", "mount"]);
  });

  it("initializes HTTP transport from manifest runtime metadata", async () => {
    const mountPoint = {} as Element;
    const manifest = createManifest();
    manifest.runtime.transport = {
      baseUrl: "https://api.example.com/framework",
    };
    const document = createDocument({
      manifest,
      mountPoint,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "ok" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/__evjs/fn");

    await startPageRuntime({
      document,
      async loadModule() {
        return {
          mount() {},
        };
      },
    });
    await callServer("fn", []);

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://api.example.com/__evjs/fn"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("does not override an application-provided transport adapter", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    initTransport({ adapter: { send } });
    const mountPoint = {} as Element;
    const manifest = createManifest();
    manifest.runtime.transport = {
      baseUrl: "https://api.example.com/framework",
    };
    const document = createDocument({
      manifest,
      mountPoint,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
      },
    });

    await startPageRuntime({
      document,
      async loadModule() {
        return {
          mount() {},
        };
      },
    });
    await callServer("fn", []);

    expect(send).toHaveBeenCalledWith("fn", [], undefined);
  });
});

function createManifest(): BuildOutput {
  return {
    version: 1,
    buildId: "test",
    distDir: "dist",
    publicPath: "/",
    runtime: {},
    assets: {},
    apps: {},
    pages: {
      home: {
        assets: { js: ["home.js"], css: [] },
        render: "ssr",
        rendering: {
          component: "server",
          html: "server",
          streaming: false,
          hydrate: "load",
        },
        mount: "#root",
        module: {
          type: "lifecycle",
          href: "/home.js",
        },
      },
    },
    routes: [],
  };
}

function createDocument(options: {
  manifest?: BuildOutput;
  mountPoint: Element;
  attributes: Record<string, string>;
}): Document {
  return {
    documentElement: {
      getAttribute(name: string) {
        return options.attributes[name] ?? null;
      },
    },
    getElementById(id: string) {
      if (!options.manifest || id !== "__EVJS_MANIFEST__") return null;
      return {
        textContent: JSON.stringify(options.manifest),
      };
    },
    querySelector(selector: string) {
      return selector === "#root" ? options.mountPoint : null;
    },
    location: {
      href: "https://example.com/home",
    },
  } as Document;
}
