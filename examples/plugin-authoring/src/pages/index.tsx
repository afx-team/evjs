import { useQuery } from "@evjs/ev/query";
import { getPluginMessage } from "@/apis/plugin.server";

export default function Home() {
  const { data, isLoading } = useQuery(getPluginMessage);

  return (
    <div>
      <h1>Plugin Example</h1>
      <p>
        This example demonstrates the evjs plugin system. Check{" "}
        <code>ev.config.ts</code> to see how plugins work.
      </p>
      <p>
        View the page source to see the HTML comment injected by{" "}
        <code>transformHtml</code>.
      </p>
      {isLoading ? (
        <p>Loading plugin message...</p>
      ) : (
        <div>
          <p>Server function: {data?.message}</p>
          <p>Client mode: {process.env.NODE_ENV}</p>
          <p>Server mode: {data?.nodeEnv}</p>
        </div>
      )}
    </div>
  );
}
