import { Link } from "@evjs/ev/navigation";

export default function HomePage() {
  return (
    <section className="panel">
      <p className="eyebrow">evjs Application + Page</p>
      <h1>Qiankun master shell</h1>
      <p>
        The root <code>page.tsx</code> maps to <code>/</code>. The plugin wraps
        the framework-managed SPA entry and starts qiankun without a manual{" "}
        <code>app.entry</code>.
      </p>
      <Link className="button" to="/catalog">
        Open catalog
      </Link>
    </section>
  );
}
