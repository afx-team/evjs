import { createRootRoute, Link, Outlet } from "@evjs/client";
import "../styles.css";

function Root() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      <nav className="border-b border-white/10 backdrop-blur-sm bg-white/5">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-6">
          <Link
            to="/"
            className="text-lg font-bold bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent"
          >
            evjs
          </Link>
          <Link
            to="/"
            className="text-sm text-slate-300 hover:text-white transition-colors"
          >
            Home
          </Link>
        </div>
      </nav>
      <Outlet />
    </div>
  );
}

export const rootRoute = createRootRoute({
  component: Root,
});
