export default function HomePage() {
  return (
    <main style={{ fontFamily: "ui-sans-serif, system-ui", margin: "2rem" }}>
      <h1>Home Page</h1>
      <p>
        This page is rendered from <code>src/pages/home.tsx</code>.
      </p>
      <p>
        <a href="/about.html">Go to About page</a>
      </p>
    </main>
  );
}
