import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBaseKey, serverFn } from "../src/client/hooks.js";
import {
  __fn_register,
  __resetForTesting,
  initTransport,
} from "../src/client/transport.js";

describe("getBaseKey", () => {
  beforeEach(() => {
    __resetForTesting();
  });

  it("returns fnId for registered server functions", () => {
    const myFn = async () => [];
    __fn_register(myFn, "mod:getUsers", "getUsers");

    expect(getBaseKey(myFn)).toBe("mod:getUsers");
  });

  it("falls back to fn.name for unregistered named functions", () => {
    async function fetchGithubUser() {
      return {};
    }
    expect(getBaseKey(fetchGithubUser)).toBe("fetchGithubUser");
  });

  it("falls back to 'unknown' for anonymous functions", () => {
    const myFn = async () => {};
    Object.defineProperty(myFn, "name", { value: "" });
    expect(getBaseKey(myFn)).toBe("unknown");
  });
});

describe("serverFn", () => {
  beforeEach(() => {
    __resetForTesting();
  });

  it("generates queryKey from fnId for registered server functions", () => {
    const myFn = async () => [];
    __fn_register(myFn, "mod:getUsers", "getUsers");

    const opts = serverFn(myFn);
    expect(opts.queryKey).toEqual(["mod:getUsers"]);
  });

  it("includes args in queryKey", () => {
    const myFn = async (_id: string) => ({});
    __fn_register(myFn, "mod:getUser", "getUser");

    const opts = serverFn(myFn, "abc");
    expect(opts.queryKey).toEqual(["mod:getUser", "abc"]);
  });

  it("uses __fn_call for registered server functions", async () => {
    const send = vi.fn().mockResolvedValue([{ id: 1 }]);
    initTransport({ transport: { send } });

    const myFn = async () => [];
    __fn_register(myFn, "mod:getUsers", "getUsers");

    const opts = serverFn(myFn);
    const result = await opts.queryFn({
      signal: undefined as unknown as AbortSignal,
    });

    expect(send).toHaveBeenCalledWith("mod:getUsers", [], {
      signal: undefined,
    });
    expect(result).toEqual([{ id: 1 }]);
  });

  it("calls raw function directly for unregistered functions", async () => {
    const rawFn = vi.fn().mockResolvedValue({ name: "evaijs" });

    const opts = serverFn(rawFn, "evaijs");
    const result = await opts.queryFn({
      signal: undefined as unknown as AbortSignal,
    });

    expect(rawFn).toHaveBeenCalledWith("evaijs");
    expect(result).toEqual({ name: "evaijs" });
  });
});
