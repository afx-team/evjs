import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __fn_call,
  __fn_register,
  __resetForTesting,
  getFnId,
  getFnName,
  initTransport,
  type ServerFunction,
} from "../src/transport.js";

describe("__fn_register / getFnId / getFnName", () => {
  beforeEach(() => {
    __resetForTesting();
  });

  it("registers a function and retrieves its ID", () => {
    const fn = async () => "result";
    __fn_register(fn, "test-id", "testFn");
    expect(getFnId(fn)).toBe("test-id");
  });

  it("retrieves the export name from fnId", () => {
    const fn = async () => {};
    __fn_register(fn, "abc:myFn", "myFn");
    expect(getFnName("abc:myFn")).toBe("myFn");
  });

  it("returns fnId as fallback when no name registered", () => {
    expect(getFnName("unknown-id")).toBe("unknown-id");
  });

  it("returns undefined for unregistered function", () => {
    const fn = async () => {};
    expect(getFnId(fn)).toBeUndefined();
  });

  it("handles registration without export name", () => {
    const fn = async () => {};
    __fn_register(fn, "no-name");
    expect(getFnId(fn)).toBe("no-name");
    expect(getFnName("no-name")).toBe("no-name"); // fallback
  });
});

describe("ServerFunction metadata (.queryKey, .fnId, .fnName)", () => {
  beforeEach(() => {
    __resetForTesting();
  });

  it("attaches .fnId and .fnName on registration", () => {
    const fn = async () => "result";
    __fn_register(fn, "abc123", "getUsers");

    const sfn = fn as unknown as { fnId: string; fnName: string };
    expect(sfn.fnId).toBe("abc123");
    expect(sfn.fnName).toBe("getUsers");
  });

  it("makes .fnId and .fnName read-only", () => {
    const fn = async () => {};
    __fn_register(fn, "abc123", "getUsers");

    const sfn = fn as unknown as { fnId: string; fnName: string };
    expect(() => {
      sfn.fnId = "changed";
    }).toThrow();
    expect(() => {
      sfn.fnName = "changed";
    }).toThrow();
  });

  it("falls back .fnName to fnId when no export name given", () => {
    const fn = async () => {};
    __fn_register(fn, "hash-only");

    const sfn = fn as unknown as { fnName: string };
    expect(sfn.fnName).toBe("hash-only");
  });

  it("attaches .queryKey() that returns [fnId]", () => {
    const fn = async () => [];
    __fn_register(fn, "mod:getUsers", "getUsers");

    const sfn = fn as unknown as {
      queryKey: (...args: unknown[]) => unknown[];
    };
    expect(sfn.queryKey()).toEqual(["mod:getUsers"]);
  });

  it(".queryKey() includes args", () => {
    const fn = async (_id: string) => ({});
    __fn_register(fn, "mod:getUser", "getUser");

    const sfn = fn as unknown as {
      queryKey: (...args: unknown[]) => unknown[];
    };
    expect(sfn.queryKey("abc")).toEqual(["mod:getUser", "abc"]);
    expect(sfn.queryKey("abc", 42)).toEqual(["mod:getUser", "abc", 42]);
  });

  it("attaches .queryOptions() that returns TanStack { queryKey, queryFn }", async () => {
    const send = vi.fn().mockResolvedValue("test result");
    initTransport({ transport: { send } });
    
    const fn = async (_id: string) => ({});
    __fn_register(fn, "mod:getUser", "getUser");

    const sfn = fn as unknown as ServerFunction<[string], unknown>;
    const opts = sfn.queryOptions("abc");
    
    expect(opts.queryKey).toEqual(["mod:getUser", "abc"]);
    
    // Check queryFn uses __fn_call properly
    const signal = new AbortController().signal;
    const result = await opts.queryFn({ signal });
    expect(send).toHaveBeenCalledWith("mod:getUser", ["abc"], { signal });
    expect(result).toBe("test result");
  });
});

describe("initTransport + __fn_call", () => {
  beforeEach(() => {
    __resetForTesting();
  });

  it("calls custom transport.send with fnId and args", async () => {
    const send = vi.fn().mockResolvedValue({ greeting: "hello" });
    initTransport({ transport: { send } });

    const result = await __fn_call("fn1", ["arg1", "arg2"]);

    expect(send).toHaveBeenCalledWith("fn1", ["arg1", "arg2"], undefined);
    expect(result).toEqual({ greeting: "hello" });
  });

  it("passes context through to transport", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    initTransport({ transport: { send } });

    const signal = new AbortController().signal;
    await __fn_call("fn2", [], { signal });

    expect(send).toHaveBeenCalledWith("fn2", [], { signal });
  });

  it("warns on double init in non-production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn().mockResolvedValue(null);

    initTransport({ transport: { send } });
    initTransport({ transport: { send } });

    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("propagates transport errors", async () => {
    const send = vi.fn().mockRejectedValue(new Error("network failure"));
    initTransport({ transport: { send } });

    await expect(__fn_call("fn3", [])).rejects.toThrow("network failure");
  });
});

describe("createFetchTransport (default)", () => {
  beforeEach(() => {
    __resetForTesting();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds static headers from config", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    initTransport({ headers: { Authorization: "Bearer xyz" } });
    await __fn_call("myFn", []);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer xyz",
        }),
      }),
    );
  });

  it("adds dynamic headers via factory function", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    // Provide dynamic async headers
    initTransport({
      headers: async () => ({ Authorization: "Bearer dynamic-token" }),
    });
    await __fn_call("myFn", []);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer dynamic-token",
        }),
      }),
    );
  });
});
