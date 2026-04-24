import { createRoot } from "react-dom/client";

function HomePage() {
  return (
    <main style={{ fontFamily: "ui-sans-serif, system-ui", margin: "2rem" }}>
      <h1>Home Page</h1>
      <p>
        This page is rendered from <code>src/home/main.tsx</code>.
      </p>
      <p>
        <a href="/about.html">Go to About page</a>
      </p>
    </main>
  );
}

const rootEl = document.getElementById("app");

if (!rootEl) {
  throw new Error("Missing #app mount element");
}

createRoot(rootEl).render(<HomePage />);
