import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __fn_call,
  __fn_register,
  __resetForTesting,
  getFnId,
  getFnName,
  initTransport,
} from "../src/client/transport.js";

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
