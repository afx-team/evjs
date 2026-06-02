import type { BuildOutput } from "@evjs/shared/manifest";
import { describe, expect, it, vi } from "vitest";
import {
  createReactRscModel,
  mountReactRscPage,
  unmountReactRscPage,
} from "../src/rsc.js";

const calls: string[] = [];

vi.mock("react-server-dom-webpack/client", () => ({
  createFromFetch(response: Promise<Response>, options?: unknown) {
    calls.push("createFromFetch");
    return {
      type: "rsc-model",
      response,
      options,
    };
  },
}));

vi.mock("react-dom/client", () => ({
  createRoot() {
    calls.push("createRoot");
    return {
      render() {
        calls.push("render");
      },
      unmount() {
        calls.push("unmount");
      },
    };
  },
}));

describe("React RSC runtime", () => {
  it("creates an RSC model from the framework Flight endpoint", async () => {
    calls.length = 0;
    const fetchMock = vi.fn(async () => new Response("flight"));

    const model = (await createReactRscModel({
      manifest: createManifest(),
      pageId: "insights",
      url: "https://example.com/insights",
      moduleBaseURL: "https://assets.example.com/",
      fetch: fetchMock,
    })) as unknown as {
      type: string;
      options: { moduleBaseURL?: string };
    };

    expect(calls).toEqual(["createFromFetch"]);
    expect(model.type).toBe("rsc-model");
    expect(model.options).toEqual({
      moduleBaseURL: "https://assets.example.com/",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/__evjs/rsc?page=insights",
    );
  });

  it("mounts and unmounts an RSC page", async () => {
    calls.length = 0;
    const mount = {} as Element;

    await mountReactRscPage({
      manifest: createManifest(),
      pageId: "insights",
      url: "https://example.com/insights",
      mount,
      fetch: async () => new Response("flight"),
    });
    unmountReactRscPage(mount);

    expect(calls).toEqual([
      "createFromFetch",
      "createRoot",
      "render",
      "unmount",
    ]);
  });
});

function createManifest(): BuildOutput {
  return {
    version: 1,
    buildId: "test",
    distDir: "dist",
    publicPath: "/",
    runtime: {
      server: {
        basePath: "/__evjs",
        fn: "/__evjs/fn",
        rsc: "/__evjs/rsc",
      },
    },
    assets: {},
    apps: {},
    pages: {},
    routes: [],
  };
}
