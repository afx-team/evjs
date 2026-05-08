"use server";
import { callTRPCProcedure } from "@trpc/server";
import { appRouter } from "../trpc";

/**
 * A Server Function that dispatches into the tRPC router.
 * This demonstrates how to combine tRPC's type-safety with
 * @evjs's RPC infrastructure.
 */
export async function trpcHandler(op: {
  path: string;
  input: unknown;
  type: "query" | "mutation" | "subscription";
}) {
  return callTRPCProcedure({
    router: appRouter,
    path: op.path,
    type: op.type,
    ctx: {},
    getRawInput: async () => op.input,
    signal: undefined,
    batchIndex: 0,
  });
}

// standard server function examples
export async function getServerTime() {
  return new Date().toISOString();
}
