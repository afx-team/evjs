import {
  createRootRoute,
  createRoute,
  initTransport,
  Link,
  Outlet,
} from "@evjs/runtime/client";
import { useEffect, useState } from "react";
import { createUser, getUsers } from "./api/users.server";

// ── WebSocket Transport ──

/**
 * Custom WebSocket transport that sends RPC calls over a persistent
 * WebSocket connection instead of HTTP POST.
 */
function createWebSocketTransport(url: string) {
  let ws: WebSocket | null = null;
  let requestId = 0;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  function getConnection(): Promise<WebSocket> {
    if (ws && ws.readyState === WebSocket.OPEN) {
      return Promise.resolve(ws);
    }

    return new Promise((resolve, reject) => {
      ws = new WebSocket(url);

      ws.onopen = () => resolve(ws as WebSocket);
      ws.onerror = () => reject(new Error("[ev] WebSocket connection failed"));

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        const handler = pending.get(data.id);
        if (!handler) return;
        pending.delete(data.id);

        if (data.error) {
          handler.reject(new Error(data.error));
        } else {
          handler.resolve(data.result);
        }
      };

      ws.onclose = () => {
        // Reject all pending requests
        for (const [id, handler] of pending) {
          handler.reject(new Error("[ev] WebSocket closed"));
          pending.delete(id);
        }
        ws = null;
      };
    });
  }

  return {
    send: async (fnId: string, args: unknown[]): Promise<unknown> => {
      const conn = await getConnection();
      const id = ++requestId;

      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        conn.send(JSON.stringify({ id, fnId, args }));
      });
    },
  };
}

// Configure the transport to use WebSocket
const wsUrl = `ws://${window.location.hostname}:${window.location.port}/ws`;
initTransport({
  transport: createWebSocketTransport(wsUrl),
});

// ── Root Route ──

function Root() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <h1>Server Functions Example (WebSocket)</h1>
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
      <h2>Users (fetched via WebSocket server functions)</h2>
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
