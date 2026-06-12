import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRemoteAppManifest,
  formatRemoteSharedNegotiation,
  resolveRemoteAppManifestUrl,
  startRemoteAppRuntime,
} from "../src/remote-app.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete globalThis.__EVJS_SHELL_MODULES__;
  delete globalThis.__EVJS_SHARED_SCOPE__;
});

describe("remote app runtime", () => {
  it("creates a minimal framework manifest for a remote app", () => {
    expect(
      createRemoteAppManifest({
        remote: "crm",
        manifest: "https://assets.example.com/crm/evjs-remote.json",
        activeWhen: "/crm/*",
      }),
    ).toMatchObject({
      version: 1,
      remotes: {
        crm: {
          manifest: "https://assets.example.com/crm/evjs-remote.json",
          activeWhen: ["/crm/*"],
        },
      },
    });
  });

  it("uses the configured manifest by default even when a query override exists", () => {
    vi.stubGlobal("location", {
      href: "http://localhost:3000/remote.html?remoteManifest=/dev-remote.json",
      hostname: "localhost",
    });

    expect(
      resolveRemoteAppManifestUrl({
        manifest: "https://assets.example.com/crm/evjs-remote.json",
      }),
    ).toBe("https://assets.example.com/crm/evjs-remote.json");
  });

  it("uses an explicit query manifest override when enabled", () => {
    vi.stubGlobal("location", {
      href: "http://localhost:3000/remote.html?remoteManifest=/dev-remote.json",
      hostname: "localhost",
    });

    expect(
      resolveRemoteAppManifestUrl({
        manifest: "https://assets.example.com/crm/evjs-remote.json",
        manifestQueryParam: "remoteManifest",
      }),
    ).toBe("/dev-remote.json");
  });

  it("uses the configured manifest when there is no query override", () => {
    vi.stubGlobal("location", {
      href: "http://localhost:3000/remote.html",
      hostname: "localhost",
    });

    expect(
      resolveRemoteAppManifestUrl({
        manifest: "https://assets.example.com/crm/evjs-remote.json",
      }),
    ).toBe("https://assets.example.com/crm/evjs-remote.json");
  });

  it("starts a remote app with manifest loading and shared negotiation", async () => {
    vi.stubGlobal("location", {
      href: "http://localhost:3000/remote.html",
      hostname: "localhost",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          version: 1,
          name: "crm",
          baseUrl: "https://assets.example.com/crm/",
          shared: {
            "remote-react": {
              shareKey: "react",
              requiredVersion: ">=19 <20",
              singleton: true,
            },
          },
          entries: {
            customers: {
              module: {
                type: "lifecycle",
                href: "crm-customers.js",
              },
              activeWhen: ["/crm/*"],
            },
          },
        }),
      ),
    );
    const events: string[] = [];

    const controller = await startRemoteAppRuntime({
      remote: "crm",
      manifest: "http://localhost:3002/evjs-remote.json",
      activeWhen: "/crm/*",
      request: "/crm/customers",
      mount: {} as Element,
      runtime: {
        shared: {
          react: {
            version: "19.2.5",
            singleton: true,
            value: { createElement: true },
          },
        },
        async loadModule(href, ctx) {
          events.push(`load:${href}`);
          events.push(`base:${ctx.remote?.manifest.baseUrl}`);
          return {
            mount() {
              events.push("mount");
            },
          };
        },
        onRemoteSharedNegotiated(event) {
          events.push(`shared:${formatRemoteSharedNegotiation(event)}`);
        },
      },
    });

    await controller.dispose();

    expect(events).toEqual([
      "shared:crm: remote-react -> 19.2.5",
      "load:http://localhost:3002/crm-customers.js",
      "base:http://localhost:3002/",
      "mount",
    ]);
  });
});
