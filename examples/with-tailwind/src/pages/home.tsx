import { createRoute } from "@evjs/client";
import { rootRoute } from "./__root";

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => (
    <main className="max-w-4xl mx-auto px-6 py-16">
      {/* Hero */}
      <div className="text-center mb-16">
        <h1
          className="text-5xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent"
          data-testid="title"
        >
          Tailwind Plugin Example
        </h1>
        <p
          className="mt-4 text-lg text-slate-400 max-w-xl mx-auto"
          data-testid="subtitle"
        >
          Styled with Tailwind CSS v4 via the evjs plugin system — no webpack
          config needed.
        </p>
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
        <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-6 hover:bg-white/10 transition-colors">
          <div className="text-3xl mb-3">🔌</div>
          <h3 className="font-semibold text-white mb-1">Plugin Loaders</h3>
          <p className="text-sm text-slate-400">
            Declare loaders in ev.config.ts. The framework handles the rest.
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-6 hover:bg-white/10 transition-colors">
          <div className="text-3xl mb-3">🎨</div>
          <h3 className="font-semibold text-white mb-1">Tailwind CSS v4</h3>
          <p className="text-sm text-slate-400">
            Full utility-first styling with zero configuration overhead.
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-6 hover:bg-white/10 transition-colors">
          <div className="text-3xl mb-3">⚡</div>
          <h3 className="font-semibold text-white mb-1">Zero Config</h3>
          <p className="text-sm text-slate-400">
            evjs works out of the box. Plugins extend it cleanly.
          </p>
        </div>
      </div>

      {/* Typography plugin demo */}
      <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-8 mb-16">
        <div className="prose prose-invert max-w-none" data-testid="prose">
          <h2>Typography Plugin</h2>
          <p>
            This section uses <code>@tailwindcss/typography</code> via the{" "}
            <code>prose</code> class. It automatically styles headings,
            paragraphs, code blocks, lists, and more with beautiful defaults.
          </p>
          <ul>
            <li>Automatic heading styles</li>
            <li>Beautiful paragraph spacing</li>
            <li>
              Styled <code>code</code> elements
            </li>
          </ul>
        </div>
      </div>

      {/* Config preview */}
      <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-6">
        <h2 className="text-lg font-semibold text-white mb-4">ev.config.ts</h2>
        <pre className="text-sm text-slate-300 bg-black/30 rounded-lg p-4 overflow-x-auto">
          <code>{`export default defineConfig({
  client: {
    plugins: [tailwind()],
  },
});`}</code>
        </pre>
      </div>
    </main>
  ),
});
