import {
  createAppRootRoute,
  createMutationProxy,
  createQueryProxy,
  createRoute,
  Link,
  Outlet,
  query,
  ServerFunctionError,
  useQueryClient,
} from "@evjs/runtime/client";
import { useState } from "react";
import * as postsApi from "./api/posts.server";
import * as usersApi from "./api/users.server";
import { getUser, searchUsers } from "./api/users.server";

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

// ── Root Route ──

function Root() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <h1>Server Functions Example</h1>
      <nav style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <Link to="/">Users</Link>
        <Link to="/search">Search</Link>
        <Link to="/user/$userId" params={{ userId: "1" }}>
          User #1
        </Link>
        <Link to="/user/$userId" params={{ userId: "999" }}>
          User #999 (error)
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}

const rootRoute = createAppRootRoute({ component: Root });

// ── Users Route (main page) ──

function UsersPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const { data: users = [], isLoading: isLoadingUsers } =
    api.users.query.getUsers.useQuery();

  const queryClient = useQueryClient();
  const { mutateAsync: createUserMutation } =
    api.users.mutation.createUser.useMutation({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: api.users.query.getUsers.queryKey(),
        });
      },
    });

  async function handleCreateUser(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!name || !email) return;
    await createUserMutation({ name, email });
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
    await createPostMutation({ title, content });
    setTitle("");
    setContent("");
  }

  if (isLoadingUsers || isLoadingPosts) return <p>Loading data from server…</p>;

  return (
    <div>
      <h2>Users (fetched via Query Proxy)</h2>
      <ul id="user-list">
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

// ── Search Route (multi-arg server function) ──

function SearchPage() {
  const [searchName, setSearchName] = useState("");
  const [searchEmail, setSearchEmail] = useState("");

  const { data: results, isLoading } = query(searchUsers).useQuery(
    searchName || "",
    searchEmail || "",
  );

  function handleSearch(e: { preventDefault: () => void }) {
    e.preventDefault();
  }

  return (
    <div>
      <h2>Search Users (multi-arg)</h2>
      <form
        onSubmit={handleSearch}
        style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}
      >
        <input
          placeholder="Name"
          id="search-name"
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
        />
        <input
          placeholder="Email"
          id="search-email"
          value={searchEmail}
          onChange={(e) => setSearchEmail(e.target.value)}
        />
        <button type="submit">Search</button>
      </form>

      {isLoading && <p>Searching…</p>}

      {results && (
        <div id="search-results">
          <p>Found {results.length} result(s)</p>
          <ul>
            {results.map((u: { id: string; name: string; email: string }) => (
              <li key={u.id}>
                {u.name} — {u.email}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  component: SearchPage,
});

// ── User Detail Route (error handling with ServerError) ──

function UserDetailPage() {
  const { userId } = userDetailRoute.useParams();
  const { data: user, error, isLoading } = query(getUser).useQuery(userId);

  if (isLoading) return <p>Loading user…</p>;

  if (error) {
    const isServerError = error instanceof ServerFunctionError;
    return (
      <div id="user-error">
        <h2>Error Loading User</h2>
        <p id="error-message">{error.message}</p>
        {isServerError && (
          <p id="error-type">ServerFunctionError (status: {error.status})</p>
        )}
      </div>
    );
  }

  if (!user) return null;

  return (
    <div id="user-detail">
      <h2>User Detail</h2>
      <p id="user-name">Name: {user.name}</p>
      <p id="user-email">Email: {user.email}</p>
    </div>
  );
}

const userDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/user/$userId",
  component: UserDetailPage,
});

// ── Route Tree ──

export const routeTree = rootRoute.addChildren([
  usersRoute,
  searchRoute,
  userDetailRoute,
]);
