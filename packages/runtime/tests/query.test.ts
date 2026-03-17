import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMutationProxy, createQueryProxy } from "../src/client/query.js";
import {
  __fn_register,
  __resetForTesting,
  initTransport,
} from "../src/client/transport.js";

describe("createQueryProxy", () => {
  beforeEach(() => {
    __resetForTesting();
  });

  it("creates proxy with queryOptions for each server function", () => {
    const getUsers = async () => [{ id: 1, name: "Alice" }];
    __fn_register(getUsers, "mod:getUsers", "getUsers");

    const proxy = createQueryProxy({ getUsers });

    const opts = proxy.getUsers.queryOptions();
    expect(opts).toHaveProperty("queryKey");
    expect(opts).toHaveProperty("queryFn");
    expect(opts.queryKey).toEqual(["mod:getUsers"]);
  });

  it("includes args in queryKey", () => {
    const getUser = async (id: string) => ({ id, name: "Alice" });
    __fn_register(getUser, "mod:getUser", "getUser");

    const proxy = createQueryProxy({ getUser });

    const opts = proxy.getUser.queryOptions("user-123");
    expect(opts.queryKey).toEqual(["mod:getUser", "user-123"]);
  });

  it("queryFn calls __fn_call with correct args", async () => {
    const send = vi.fn().mockResolvedValue({ id: 1, name: "Alice" });
    initTransport({ transport: { send } });

    const getUser = async (id: string) => ({ id, name: id });
    __fn_register(getUser, "mod:getUser", "getUser");

    const proxy = createQueryProxy({ getUser });
    const opts = proxy.getUser.queryOptions("user-456");

    // Call the queryFn directly (it uses __fn_call internally)
    const result = await opts.queryFn({
      signal: undefined as unknown as AbortSignal,
    });
    expect(send).toHaveBeenCalledWith("mod:getUser", ["user-456"], {
      signal: undefined,
    });
    expect(result).toEqual({ id: 1, name: "Alice" });
  });

  it("returns stable queryKey array", () => {
    const getUsers = async () => [];
    __fn_register(getUsers, "mod:getUsers", "getUsers");

    const proxy = createQueryProxy({ getUsers });

    expect(proxy.getUsers.queryKey()).toEqual(["mod:getUsers"]);
    expect(proxy.getUsers.queryKey("extra")).toEqual(["mod:getUsers", "extra"]);
  });
});

describe("createMutationProxy", () => {
  beforeEach(() => {
    __resetForTesting();
  });

  it("creates proxy with mutationOptions for each server function", () => {
    const createUser = async (data: { name: string }) => ({ id: 1, ...data });
    __fn_register(createUser, "mod:createUser", "createUser");

    const proxy = createMutationProxy({ createUser });

    const opts = proxy.createUser.mutationOptions();
    expect(opts).toHaveProperty("mutationFn");
    expect(typeof opts.mutationFn).toBe("function");
  });

  it("mutationFn forwards variables directly to the function", async () => {
    // The mutationFn calls fn(variables), where fn is the original function.
    // In a real app, fn would be the client stub that calls __fn_call internally.
    // In tests, we use a vi.fn() to verify the args.
    const createUser = vi
      .fn()
      .mockResolvedValue({ id: 1, name: "Alice", email: "alice@test.com" });
    __fn_register(createUser, "mod:createUser", "createUser");

    const proxy = createMutationProxy({ createUser });
    const opts = proxy.createUser.mutationOptions();

    // This simulates what TanStack does:
    // mutate({ name, email }) → mutationFn({ name, email }) → fn({ name, email })
    const result = await opts.mutationFn?.({
      name: "Alice",
      email: "alice@test.com",
    });

    // fn receives the variables directly — NOT wrapped in an array
    expect(createUser).toHaveBeenCalledWith({
      name: "Alice",
      email: "alice@test.com",
    });
    expect(result).toEqual({
      id: 1,
      name: "Alice",
      email: "alice@test.com",
    });
  });

  it("mutationFn forwards single primitive arg directly", async () => {
    const deleteUser = vi.fn().mockResolvedValue(true);
    __fn_register(deleteUser, "mod:deleteUser", "deleteUser");

    const proxy = createMutationProxy({ deleteUser });
    const opts = proxy.deleteUser.mutationOptions();

    // mutate(42) → mutationFn(42) → fn(42)
    await opts.mutationFn?.(42);

    expect(deleteUser).toHaveBeenCalledWith(42);
  });

  it("mutationFn does not double-wrap array args", async () => {
    // Ensure mutationFn passes the value as-is, even if it's an array
    const batchDelete = vi.fn().mockResolvedValue({ deleted: 3 });
    __fn_register(batchDelete, "mod:batchDelete", "batchDelete");

    const proxy = createMutationProxy({ batchDelete });
    const opts = proxy.batchDelete.mutationOptions();

    await opts.mutationFn?.([1, 2, 3]);

    // Should pass the array directly, not spread it
    expect(batchDelete).toHaveBeenCalledWith([1, 2, 3]);
  });
});
