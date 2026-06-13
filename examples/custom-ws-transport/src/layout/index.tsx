import { Link } from "@evjs/client";
import type { ReactNode } from "react";

export default function Root({ children }: { children?: ReactNode }) {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <h1>Server Functions Example (WebSocket)</h1>
      <nav style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <Link to="/">Users</Link>
      </nav>
      {children}
    </div>
  );
}
