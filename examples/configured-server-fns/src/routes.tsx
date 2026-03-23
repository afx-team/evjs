import {
  createAppRootRoute,
  createRoute,
  Link,
  Outlet,
  serverFn,
  useMutation,
  useQuery,
  useQueryClient,
} from "@evjs/runtime/client";
import { useState } from "react";
import { createUser, getUsers } from "./api/users.server";

// ── Root Route ──

function Root() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>Configured Server Functions</h1>
      <p style={{ color: "#666" }}>
        Custom <code>ev.config.ts</code> with server function queries.
      </p>
      <nav style={{ marginBottom: "1rem" }}>
        <Link to="/" style={{ textDecoration: "none", fontWeight: "bold" }}>
          Users
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}

const rootRoute = createAppRootRoute({ component: Root });

// ── Users Route ──

function UsersPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const { data: users = [], isLoading } = useQuery(serverFn(getUsers));

  const queryClient = useQueryClient();
  const { mutateAsync: doCreateUser } = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serverFn(getUsers).queryKey });
    },
  });

  async function handleCreate(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!name || !email) return;
    await doCreateUser({ name, email });
    setName("");
    setEmail("");
  }

  if (isLoading) return <p>Loading users from server…</p>;

  return (
    <div>
      <h2>Users</h2>
      <ul>
        {users.map((u) => (
          <li key={u.id}>
            {u.name} — {u.email}
          </li>
        ))}
      </ul>
      <h3>Add User</h3>
      <form onSubmit={handleCreate} style={{ display: "flex", gap: "0.5rem" }}>
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
        <button type="submit">Create</button>
      </form>
    </div>
  );
}

const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: UsersPage,
});

export const routeTree = rootRoute.addChildren([usersRoute]);
