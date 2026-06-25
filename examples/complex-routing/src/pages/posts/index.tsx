import { Link, useQuery } from "@evjs/ev/page";
import { getPosts } from "../../api/data.server";

const styles = {
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    padding: "1rem",
    marginBottom: "0.75rem",
  },
};

export default function PostsPage() {
  const { data: posts } = useQuery(getPosts);

  return (
    <div>
      <h2>Posts</h2>
      {posts?.map((post) => (
        <div key={post.id} style={styles.card}>
          <Link
            to="/posts/$postId"
            params={{ postId: post.id }}
            style={{ textDecoration: "none", color: "#111" }}
          >
            <strong>{post.title}</strong>
          </Link>
          <p style={{ color: "#6b7280" }}>{post.body}</p>
        </div>
      ))}
    </div>
  );
}
