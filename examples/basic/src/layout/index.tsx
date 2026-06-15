import { Link } from "@evjs/client";
import type { ReactNode } from "react";

const navLinkStyle = { textDecoration: "none", color: "#0f172a" };

export default function Root({ children }: { children?: ReactNode }) {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <h1>Server Functions Example</h1>
      <nav style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <Link to="/" style={navLinkStyle}>
          Users
        </Link>
        <Link to="/about" style={navLinkStyle}>
          Static Route
        </Link>
        <Link to="/users/$userId" params={{ userId: "1" }} style={navLinkStyle}>
          Dynamic Route
        </Link>
        <Link to="/search" search={{ tab: "all" }} style={navLinkStyle}>
          Search Route
        </Link>
      </nav>
      {children}
    </div>
  );
}
