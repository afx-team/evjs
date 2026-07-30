import { Link } from "@evjs/ev/navigation";
import type { ReactNode } from "react";
import "../styles.css";

export default function RootLayout({ children }: { children?: ReactNode }) {
  return (
    <main className="shell">
      <header className="topbar">
        <strong>evjs qiankun master</strong>
        <nav>
          <Link to="/" activeProps={{ className: "active" }}>
            Home
          </Link>
          <a href="/catalog">Catalog</a>
        </nav>
      </header>
      {children}
    </main>
  );
}
