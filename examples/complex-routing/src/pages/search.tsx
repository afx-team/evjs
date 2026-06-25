import { Link, usePageSearch, useQuery } from "@evjs/ev/page";
import { getPosts } from "../api/data.server";

const styles = {
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    padding: "1rem",
    marginBottom: "0.75rem",
  },
};

export function validateSearch(search: Record<string, unknown>) {
  return {
    q: (search.q as string) || "",
  };
}

export default function SearchPage() {
  const search = usePageSearch();
  const q = typeof search.q === "string" ? search.q : "";
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
