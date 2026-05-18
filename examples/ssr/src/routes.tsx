import { useQuery } from "@evjs/client";
import {
  createAppRootRoute,
  createRoute,
  Link,
  Outlet,
} from "@evjs/client/route";
import { useState } from "react";
import { getGreeting } from "./data.server";

const greetingQuery = {
  queryKey: ["greeting"],
  queryFn: getGreeting,
  staleTime: 60_000,
};

function HydrationCounter() {
  const [count, setCount] = useState(0);

  return (
    <button
      type="button"
      data-testid="counter"
      onClick={() => setCount((value) => value + 1)}
      style={{
        border: "1px solid #334155",
        borderRadius: 6,
        background: "#fff",
        color: "#0f172a",
        cursor: "pointer",
        padding: "0.45rem 0.7rem",
      }}
    >
      Count {count}
    </button>
  );
}

function RootLayout() {
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        margin: "0 auto",
        maxWidth: 760,
        padding: "1.25rem",
      }}
    >
      <h1>SSR Example</h1>
      <nav
        aria-label="Primary"
        style={{
          alignItems: "center",
          borderBottom: "1px solid #e2e8f0",
          display: "flex",
          gap: "1rem",
          marginBottom: "1rem",
          paddingBottom: "0.75rem",
        }}
      >
        <Link to="/">Home</Link>
        <Link to="/about">About</Link>
        <HydrationCounter />
      </nav>
      <Outlet />
    </main>
  );
}

function HomePage() {
  const { data } = useQuery(greetingQuery);

  return (
    <section>
      <h2>Home rendered on the server</h2>
      <p data-testid="home-copy">
        This route is delivered as HTML before the client bundle hydrates.
      </p>
      <p data-testid="loader-data">{data?.message}</p>
    </section>
  );
}

function AboutPage() {
  return (
    <section>
      <h2>About rendered on the server</h2>
      <p data-testid="about-copy">
        Direct document requests are routed through the Hono document handler.
      </p>
    </section>
  );
}

export const rootRoute = createAppRootRoute({ component: RootLayout });

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  loader: ({ context }) => context.queryClient.ensureQueryData(greetingQuery),
  component: HomePage,
});

export const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/about",
  component: AboutPage,
});

export const routeTree = rootRoute.addChildren([homeRoute, aboutRoute]);
