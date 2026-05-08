import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import {
  registerServerReference,
  registry,
} from "../src/functions/register.js";

describe("createApp", () => {
  beforeEach(() => {
    registry.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the build-time endpoint define by default", async () => {
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/rpc");
    registerServerReference(async () => "ok", "fn1");

    const app = createApp();
    const res = await app.request("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fnId: "fn1", args: [] }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "ok" });
  });
});
