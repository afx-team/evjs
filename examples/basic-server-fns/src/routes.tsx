import {
  createRootRoute,
  createRoute,
  getFnQueryKey,
  Link,
  Outlet,
  useMutation,
  useQuery,
  useQueryClient,
} from "@evjs/client";
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

// ── Users Route ──

function UsersPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const queryClient = useQueryClient();

  // Use the framework's useQuery hook instead of manual useState + useEffect
  const { data: users = [], isLoading } = useQuery(getUsers);

  // Use useMutation for server function calls that modify data
  const createUserMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      // Invalidate and refetch users list after successful creation
      queryClient.invalidateQueries({ queryKey: getFnQueryKey(getUsers) });
      setName("");
      setEmail("");
    },
  });

  function handleCreate(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!name || !email) return;
    createUserMutation.mutate({ name, email });
  }

  if (isLoading) return <p>Loading users from server…</p>;

  return (
    <div>
      <h2>Users (fetched via direct server function call)</h2>
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

// ── Route Tree ──

export const routeTree = rootRoute.addChildren([usersRoute]);
