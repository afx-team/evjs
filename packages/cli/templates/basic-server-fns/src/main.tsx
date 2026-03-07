import {
  createApp,
  createRootRoute,
  createRoute,
  Link,
  Outlet,
} from "@evjs/runtime/client";
import { useEffect, useState } from "react";
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

  const [users, setUsers] = useState<
    { id: string; name: string; email: string }[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    getUsers()
      .then((data) => {
        if (mounted) {
          setUsers(data);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.error(err);
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function handleCreate(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!name || !email) return;
    try {
      await createUser({ name, email });
      setName("");
      setEmail("");
      const data = await getUsers();
      setUsers(data);
    } catch (err) {
      console.error(err);
    }
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

// ── Mount ──

const routeTree = rootRoute.addChildren([usersRoute]);

createApp({ routeTree }).render("#app");
