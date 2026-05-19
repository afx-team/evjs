import { useQuery } from "@evjs/client";
import { createLazyRoute } from "@evjs/client/route";
import { greetingQuery } from "./greeting";

function HomePage() {
  const { data } = useQuery(greetingQuery);

  return (
    <section>
      <h2>Home rendered on the server</h2>
      <p data-testid="home-copy">
        This route is delivered as HTML before the client bundle hydrates.
      </p>
      <p data-testid="loader-data">{data?.message}</p>
    </section>
  );
}

export const Route = createLazyRoute("/")({
  component: HomePage,
});
