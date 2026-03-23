import { beforeEach, describe, expect, it, vi } from "vitest";
import { serverFn } from "../src/client/hooks.js";
import {
  __fn_register,
  __resetForTesting,
  initTransport,
} from "../src/client/transport.js";

describe("serverFn", () => {
  beforeEach(() => {
    __resetForTesting();
  });

  it("generates queryKey from fnId", () => {
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

  it("uses __fn_call for RPC transport", async () => {
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

  it("throws for non-server functions", () => {
    const rawFn = vi.fn().mockResolvedValue({});
    expect(() => serverFn(rawFn)).toThrow(
      /serverFn\(\) only accepts server functions/,
    );
  });
});
