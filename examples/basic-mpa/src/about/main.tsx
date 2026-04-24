import { createRoot } from "react-dom/client";

function AboutPage() {
  return (
    <main style={{ fontFamily: "ui-sans-serif, system-ui", margin: "2rem" }}>
      <h1>About Page</h1>
      <p>
        This page is rendered from <code>src/about/main.tsx</code>.
      </p>
      <p>
        <a href="/home.html">Back to Home page</a>
      </p>
    </main>
  );
}

const rootEl = document.getElementById("app");

if (!rootEl) {
  throw new Error("Missing #app mount element");
}

createRoot(rootEl).render(<AboutPage />);
