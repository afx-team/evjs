import {
  createApp,
  createMutationProxy,
  createQueryProxy,
  createRootRoute,
  createRoute,
  Link,
  Outlet,
  useQueryClient,
} from "@evjs/runtime/client";
import { useState } from "react";
import { createUser, getUsers } from "./api/users.server";

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

const rootRoute = createRootRoute({ component: Root });

// ── API Proxy ──
const api = {
  query: createQueryProxy({ getUsers, createUser }),
  mutation: createMutationProxy({ getUsers, createUser }),
};

// ── Users Route ──

function UsersPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const { data: users = [], isLoading } = api.query.getUsers.useQuery([]);

  const queryClient = useQueryClient();
  const { mutateAsync: createMutation } = api.mutation.createUser.useMutation({
    onSuccess: () => {
      // Use the stable queryKey for cache invalidation
      queryClient.invalidateQueries({
        queryKey: api.query.getUsers.queryKey(),
      });
    },
  });

  async function handleCreate(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!name || !email) return;
    await createMutation([{ name, email }]);
    setName("");
    setEmail("");
  }

  if (isLoading) return <p>Loading users from server…</p>;

  return (
    <div>
      <h2>Users (fetched via friendly useServerQuery)</h2>
      <ul>
        {users.map((u: { id: string; name: string; email: string }) => (
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

// ── Mount ──

const routeTree = rootRoute.addChildren([usersRoute]);

createApp({ routeTree }).render("#app");
