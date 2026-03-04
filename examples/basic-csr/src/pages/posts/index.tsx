import { createRoute, Outlet, Link } from "@evai/shell";
import { rootRoute } from "../../main";

const posts = [
  { id: "1", title: "First Post", body: "Hello world!" },
  { id: "2", title: "Second Post", body: "Another day, another post." },
  { id: "3", title: "Third Post", body: "Three's a charm." },
];

export const postsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/posts",
  component: function Posts() {
    return (
      <div style={{ display: "flex", gap: "1rem" }}>
        <ul style={{ listStyle: "none", padding: 0, minWidth: 160 }}>
          {posts.map((p) => (
            <li key={p.id} style={{ marginBottom: "0.25rem" }}>
              <Link
                to="/posts/$postId"
                params={{ postId: p.id }}
                activeProps={{ style: { fontWeight: "bold" } }}
              >
                {p.title}
              </Link>
            </li>
          ))}
        </ul>
        <Outlet />
      </div>
    );
  },
});

export const postsIndexRoute = createRoute({
  getParentRoute: () => postsRoute,
  path: "/",
  component: function PostsIndex() {
    return <p style={{ color: "#6b7280" }}>Select a post.</p>;
  },
});

export const postDetailRoute = createRoute({
  getParentRoute: () => postsRoute,
  path: "$postId",
  component: function PostDetail() {
    const { postId } = postDetailRoute.useParams();
    const post = posts.find((p) => p.id === postId);
    if (!post) return <p>Post not found.</p>;
    return (
      <div>
        <h2>{post.title}</h2>
        <p>{post.body}</p>
      </div>
    );
  },
});
