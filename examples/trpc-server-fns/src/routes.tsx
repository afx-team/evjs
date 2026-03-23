import { createRootRoute, createRoute, Outlet, useQuery } from "@evjs/client";
import { createTRPCClient, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { useCallback, useEffect, useState } from "react";
import { getServerTime, trpcHandler } from "./api/trpc.server";
import type { AppRouter } from "./trpc";

// ── tRPC Glue ──

// Custom link that redirects tRPC calls to our @evjs Server Function
const serverFnLink = (): TRPCLink<AppRouter> => {
  return () => {
    return ({ op }) => {
      return observable((observer) => {
        trpcHandler(op)
          .then((res) => {
            observer.next({ result: { data: res.result.data } });
            observer.complete();
          })
          .catch((err) => {
            observer.error(err);
          });
      });
    };
  };
};

const trpc = createTRPCClient<AppRouter>({
  links: [serverFnLink()],
});

// ── Root Route ──

function Root() {
  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "2rem",
        maxWidth: "800px",
        margin: "0 auto",
      }}
    >
      <header
        style={{
          borderBottom: "1px solid #eee",
          marginBottom: "2rem",
          paddingBottom: "1rem",
        }}
      >
        <h1 style={{ margin: 0 }}>@evjs + tRPC</h1>
        <p style={{ color: "#666" }}>
          Combining Zero-Config Server Functions with tRPC Type-Safety
        </p>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

const rootRoute = createRootRoute({ component: Root });

// ── Home Route ──

function HomePage() {
  const [trpcData, setTrpcData] = useState<unknown>(null);
  const { data: serverTime, refetch: refetchTime } = useQuery(getServerTime);

  const refreshAction = useCallback(async () => {
    // 1. Call via tRPC (proxied through Server Function)
    const res = await trpc.hello.query();
    setTrpcData(res);

    // 2. Refresh standard server function query
    refetchTime();
  }, [refetchTime]);

  useEffect(() => {
    refreshAction();
  }, [refreshAction]);

  return (
    <div style={{ display: "grid", gap: "2rem" }}>
      <section
        style={{
          background: "#f9f9f9",
          padding: "1.5rem",
          borderRadius: "8px",
        }}
      >
        <h3>1. tRPC Call</h3>
        <p>
          This call uses the tRPC client, but is actually transported via an{" "}
          <code>@evjs</code> Server Function.
        </p>
        <pre style={{ background: "#eee", padding: "1rem" }}>
          {trpcData ? JSON.stringify(trpcData, null, 2) : "Loading..."}
        </pre>
      </section>

      <section
        style={{
          background: "#f0f7ff",
          padding: "1.5rem",
          borderRadius: "8px",
        }}
      >
        <h3>2. Direct Server Function</h3>
        <p>
          This is a standard <code>"use server"</code> call.
        </p>
        <p>
          <strong>Server Time:</strong> {String(serverTime) || "..."}
        </p>
      </section>

      <button
        type="button"
        onClick={refreshAction}
        style={{
          padding: "0.75rem 1.5rem",
          fontSize: "1rem",
          cursor: "pointer",
          borderRadius: "4px",
          border: "none",
          background: "#0070f3",
          color: "white",
        }}
      >
        Refresh All
      </button>
    </div>
  );
}

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

// ── Route Tree ──

export const routeTree = rootRoute.addChildren([homeRoute]);
