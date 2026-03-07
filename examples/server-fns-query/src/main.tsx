import {
  createApp,
  createAppRootRoute,
  createMutationProxy,
  createQueryProxy,
  createRoute,
  Link,
  Outlet,
  useQueryClient,
} from "@evjs/runtime/client";
import { useState } from "react";
import * as postsApi from "./api/posts.server";
import * as usersApi from "./api/users.server";

// ── Root Route ──

function Root() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <h1>Server Functions Example</h1>
      <nav style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <Link to="/">Users</Link>
      </nav>
      <Outlet />
    </div>
  );
}

const rootRoute = createAppRootRoute({ component: Root });

// ── API Proxy ──
const api = {
  users: {
    query: createQueryProxy(usersApi),
    mutation: createMutationProxy(usersApi),
  },
  posts: {
    query: createQueryProxy(postsApi),
    mutation: createMutationProxy(postsApi),
  },
};

// ── Users Route ──

function UsersPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const { data: users = [], isLoading: isLoadingUsers } =
    api.users.query.getUsers.useQuery();

  const queryClient = useQueryClient();
  const { mutateAsync: createUserMutation } =
    api.users.mutation.createUser.useMutation({
      onSuccess: () => {
        // Use the stable queryKey for cache invalidation
        queryClient.invalidateQueries({
          queryKey: api.users.query.getUsers.queryKey(),
        });
      },
    });

  async function handleCreateUser(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!name || !email) return;
    await createUserMutation([{ name, email }]);
    setName("");
    setEmail("");
  }

  // Posts State
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const { data: posts = [], isLoading: isLoadingPosts } =
    api.posts.query.getPosts.useQuery();

  const { mutateAsync: createPostMutation } =
    api.posts.mutation.createPost.useMutation({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: api.posts.query.getPosts.queryKey(),
        });
      },
    });

  async function handleCreatePost(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!title || !content) return;
    await createPostMutation([{ title, content }]);
    setTitle("");
    setContent("");
  }

  if (isLoadingUsers || isLoadingPosts) return <p>Loading data from server…</p>;

  return (
    <div>
      <h2>Users (fetched via Query Proxy)</h2>
      <ul>
        {users.map((u: { id: string; name: string; email: string }) => (
          <li key={u.id}>
            {u.name} — {u.email}
          </li>
        ))}
      </ul>

      <h3>Add User</h3>
      <form
        onSubmit={handleCreateUser}
        style={{ display: "flex", gap: "0.5rem", marginBottom: "2rem" }}
      >
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit">Create User</button>
      </form>

      <hr style={{ margin: "2rem 0", borderColor: "#eee" }} />

      <h2>Posts</h2>
      <ul>
        {posts.map((p: { id: string; title: string; content: string }) => (
          <li key={p.id}>
            <strong>{p.title}</strong> — {p.content}
          </li>
        ))}
      </ul>

      <h3>Add Post</h3>
      <form
        onSubmit={handleCreatePost}
        style={{ display: "flex", gap: "0.5rem" }}
      >
        <input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          placeholder="Content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <button type="submit">Create Post</button>
      </form>
    </div>
  );
}

const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: UsersPage,
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(
        api.users.query.getUsers.queryOptions(),
      ),
      context.queryClient.ensureQueryData(
        api.posts.query.getPosts.queryOptions(),
      ),
    ]),
});

// ── Mount ──

const routeTree = rootRoute.addChildren([usersRoute]);

createApp({ routeTree }).render("#app");
