import { initTRPC } from "@trpc/server";

const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const appRouter = router({
  hello: publicProcedure.query(() => {
    return {
      message: "Hello from tRPC! (called via Server Function proxy)",
    };
  }),
});

export type AppRouter = typeof appRouter;
