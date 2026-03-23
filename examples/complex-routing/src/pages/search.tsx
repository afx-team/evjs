import { createRoute, Link, useQuery } from "@evjs/client";
import { getPosts } from "../api/data.server";
import { rootRoute } from "./__root";

const styles = {
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    padding: "1rem",
    marginBottom: "0.75rem",
  },
};

function SearchPage() {
  const { q } = searchRoute.useSearch();
  const { data: results } = useQuery(getPosts, q || undefined);

  return (
    <div>
      <h2>Search</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const q = form.get("q") as string;
          window.location.search = `?q=${encodeURIComponent(q)}`;
        }}
      >
        <input
          name="q"
          defaultValue={q}
          placeholder="Search posts..."
          style={{
            padding: "0.5rem",
            width: 300,
            borderRadius: 4,
            border: "1px solid #d1d5db",
          }}
        />
      </form>
      <div style={{ marginTop: "1rem" }}>
        {q && <p style={{ color: "#6b7280" }}>Results for "{q}":</p>}
        {results?.map((post) => (
          <div key={post.id} style={styles.card}>
            <Link
              to="/posts/$postId"
              params={{ postId: post.id }}
              style={{ textDecoration: "none", color: "#111" }}
            >
              <strong>{post.title}</strong>
            </Link>
            <p
              style={{ margin: "0.25rem 0 0", color: "#6b7280", fontSize: 14 }}
            >
              {post.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  validateSearch: (search: Record<string, unknown>) => ({
    q: (search.q as string) || "",
  }),
  component: SearchPage,
});
