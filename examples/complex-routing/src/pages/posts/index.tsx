import { createRoute, Link, Outlet, query } from "@evjs/runtime/client";
import { getPost, getPosts } from "../../api/data.server";
import { rootRoute } from "../__root";

const styles = {
  sidebar: { display: "flex", gap: "1.5rem" },
  nav: {
    minWidth: 180,
    borderRight: "1px solid #e5e7eb",
    paddingRight: "1rem",
  },
  tag: {
    display: "inline-block",
    background: "#f3f4f6",
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 12,
    marginRight: 4,
  },
};

// ── Posts layout (/posts) ──

function PostsLayout() {
  const { data: posts } = query(getPosts).useQuery();
  return (
    <div style={styles.sidebar}>
      <div style={styles.nav}>
        <h3 style={{ marginTop: 0 }}>Posts</h3>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {posts?.map((p) => (
            <li key={p.id} style={{ marginBottom: "0.25rem" }}>
              <Link
                to="/posts/$postId"
                params={{ postId: p.id }}
                style={{ textDecoration: "none", color: "#374151" }}
                activeProps={{ style: { fontWeight: "bold", color: "#111" } }}
              >
                {p.title}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div style={{ flex: 1 }}>
        <Outlet />
      </div>
    </div>
  );
}

export const postsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/posts",
  component: PostsLayout,
});

// ── Posts index (/posts/) ──

export const postsIndexRoute = createRoute({
  getParentRoute: () => postsRoute,
  path: "/",
  component: () => (
    <p style={{ color: "#6b7280" }}>← Select a post from the sidebar</p>
  ),
});

// ── Post detail (/posts/$postId) ──

function PostDetail() {
  const { postId } = postDetailRoute.useParams();
  const { data: post } = query(getPost).useQuery(postId);

  if (!post) return <p>Loading...</p>;
  return (
    <div>
      <h2>{post.title}</h2>
      <p style={{ color: "#6b7280" }}>
        by{" "}
        <Link to="/users/$username" params={{ username: post.author }}>
          {post.author}
        </Link>
      </p>
      <p>{post.body}</p>
      <div>
        {post.tags.map((tag) => (
          <span key={tag} style={styles.tag}>
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

export const postDetailRoute = createRoute({
  getParentRoute: () => postsRoute,
  path: "$postId",
  loader: ({ params, context }) =>
    context.queryClient.ensureQueryData(
      query(getPost).queryOptions(params.postId),
    ),
  component: PostDetail,
});
