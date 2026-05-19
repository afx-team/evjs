import { createLazyRoute } from "@evjs/client/route";

function AboutPage() {
  return (
    <section>
      <h2>About rendered on the server</h2>
      <p data-testid="about-copy">
        Direct document requests are routed through the Hono document handler.
      </p>
    </section>
  );
}

export const Route = createLazyRoute("/about")({
  component: AboutPage,
});
