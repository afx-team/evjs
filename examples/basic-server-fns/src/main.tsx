import {
  createApp,
  createRootRoute,
  createRoute,
  Outlet,
  Link,
} from "@evjs/runtime/client";
import { getUsers, createUser } from "./api/users.server";

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
  const [users, setUsers] = React.useState<
    Array<{ id: string; name: string; email: string }>
  >([]);
  const [loading, setLoading] = React.useState(true);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");

  React.useEffect(() => {
    getUsers().then((data) => {
      setUsers(data as Array<{ id: string; name: string; email: string }>);
      setLoading(false);
    });
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !email) return;
    const newUser = (await createUser({ name, email })) as {
      id: string;
      name: string;
      email: string;
    };
    setUsers((prev) => [...prev, newUser]);
    setName("");
    setEmail("");
  }

  if (loading) return <p>Loading users from server…</p>;

  return (
    <div>
      <h2>Users (fetched via server function)</h2>
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

// ── Mount ──

import * as React from "react";

const routeTree = rootRoute.addChildren([usersRoute]);

createApp({ routeTree }).render("#app");
