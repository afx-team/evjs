import {
  createAppRootRoute,
  createRoute,
  Link,
  Outlet,
} from "@evjs/client/route";
import { useState } from "react";
import { greetingQuery } from "./routes/greeting";

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
        <Link to="/antd">AntD</Link>
        <HydrationCounter />
      </nav>
      <Outlet />
    </main>
  );
}

export const rootRoute = createAppRootRoute({ component: RootLayout });

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  loader: ({ context }) => context.queryClient.ensureQueryData(greetingQuery),
}).lazy(() => import("./routes/home.lazy").then((d) => d.Route));

export const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/about",
}).lazy(() => import("./routes/about.lazy").then((d) => d.Route));

export const antdRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/antd",
}).lazy(() => import("./routes/antd.lazy").then((d) => d.Route));

export const routeTree = rootRoute.addChildren([
  homeRoute,
  aboutRoute,
  antdRoute,
]);
