import { PageScopeNote } from "./components/PageScopeNote";

export default function HomePage() {
  return (
    <main style={{ fontFamily: "ui-sans-serif, system-ui", margin: "2rem" }}>
      <h1>Home Page</h1>
      <p>
        This page is rendered from <code>src/pages/page.tsx</code>.
      </p>
      <PageScopeNote />
      <p>
        <a href="/about">Go to About page</a>
      </p>
    </main>
  );
}
