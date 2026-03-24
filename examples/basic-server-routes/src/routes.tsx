import {
  createRootRoute,
  createRoute,
  Outlet,
} from "@evjs/client";
import { useState } from "react";

// ── Types ──

interface Post {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

// ── Root Route ──

function Root() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <h1>Route Handlers Example</h1>
      <p style={{ color: "#666" }}>
        REST endpoints powered by <code>createRouteHandler()</code>
      </p>
      <Outlet />
    </div>
  );
}

const rootRoute = createRootRoute({ component: Root });

// ── Posts Page ──

function PostsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Fetch posts from REST endpoint
  async function fetchPosts() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/posts");
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = await res.json();
      setPosts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  // Create a new post via POST
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;

    setIsCreating(true);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      setTitle("");
      setBody("");
      await fetchPosts();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreating(false);
    }
  }

  // Delete a post via DELETE
  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/posts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      await fetchPosts();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Initial fetch
  useState(() => {
    fetchPosts();
  });

  return (
    <div>
      <h2>Posts</h2>

      {error && (
        <p style={{ color: "red" }}>Error: {error}</p>
      )}

      {isLoading ? (
        <p>Loading posts from <code>GET /api/posts</code>…</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {posts.map((post) => (
            <li
              key={post.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: 8,
                padding: "0.75rem 1rem",
                marginBottom: "0.5rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <strong>{post.title}</strong>
                <p style={{ margin: "0.25rem 0 0", color: "#555" }}>
                  {post.body}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(post.id)}
                style={{
                  background: "none",
                  border: "1px solid #c00",
                  color: "#c00",
                  borderRadius: 4,
                  padding: "0.25rem 0.5rem",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                Delete
              </button>
            </li>
          ))}
          {posts.length === 0 && <li style={{ color: "#999" }}>No posts yet.</li>}
        </ul>
      )}

      <h3>Create Post</h3>
      <form
        onSubmit={handleCreate}
        style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 400 }}
      >
        <input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ padding: "0.5rem" }}
        />
        <textarea
          placeholder="Body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          style={{ padding: "0.5rem" }}
        />
        <button
          type="submit"
          disabled={isCreating}
          style={{ padding: "0.5rem", cursor: "pointer" }}
        >
          {isCreating ? "Creating…" : "Create Post"}
        </button>
      </form>

      <h3 style={{ marginTop: "1.5rem" }}>Health Check</h3>
      <HealthCheck />
    </div>
  );
}

// ── Health Check Component ──

function HealthCheck() {
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);

  async function checkHealth() {
    const res = await fetch("/api/health");
    setHealth(await res.json());
  }

  return (
    <div>
      <button type="button" onClick={checkHealth} style={{ padding: "0.5rem", cursor: "pointer" }}>
        GET /api/health
      </button>
      {health && (
        <pre style={{ background: "#f5f5f5", padding: "0.75rem", borderRadius: 4 }}>
          {JSON.stringify(health, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ── Route ──

const postsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: PostsPage,
});

// ── Route Tree ──

export const routeTree = rootRoute.addChildren([postsRoute]);
