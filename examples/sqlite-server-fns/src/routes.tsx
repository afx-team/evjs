import {
  createAppRootRoute,
  createRoute,
  Link,
  Outlet,
  getFnQueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@evjs/client";
import { useState } from "react";
import type { Todo, User } from "./api/db.server";
import {
  createTodo,
  createUser,
  deleteTodo,
  deleteUser,
  getTodos,
  getUsers,
  toggleTodo,
} from "./api/db.server";

// ── Root Route ──

function Root() {
  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "2rem",
        maxWidth: "800px",
        margin: "0 auto",
      }}
    >
      <h1>📦 SQLite Server Functions</h1>
      <p style={{ color: "#666" }}>
        Real database-backed server functions using <code>node:sqlite</code>.
      </p>
      <nav
        style={{
          display: "flex",
          gap: "1rem",
          marginBottom: "1.5rem",
          borderBottom: "1px solid #eee",
          paddingBottom: "1rem",
        }}
      >
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
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const { data: users = [], isLoading } = useQuery(getUsers);

  const queryClient = useQueryClient();
  const { mutateAsync: doCreateUser, isPending: isCreating } = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getFnQueryKey(getUsers) });
    },
  });

  const { mutateAsync: doDeleteUser } = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getFnQueryKey(getUsers) });
      if (selectedUserId) setSelectedUserId(null);
    },
  });

  async function handleCreate(e: { preventDefault: () => void }) {
    e.preventDefault();
    setError("");
    if (!name || !email) return;
    try {
      await doCreateUser({ name, email });
      setName("");
      setEmail("");
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    }
  }

  if (isLoading) return <p>Loading from SQLite…</p>;

  return (
    <div>
      <h2>Users</h2>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          marginBottom: "1.5rem",
        }}
      >
        <thead>
          <tr style={{ borderBottom: "2px solid #ddd", textAlign: "left" }}>
            <th style={{ padding: "0.5rem" }}>ID</th>
            <th style={{ padding: "0.5rem" }}>Name</th>
            <th style={{ padding: "0.5rem" }}>Email</th>
            <th style={{ padding: "0.5rem" }}>Created</th>
            <th style={{ padding: "0.5rem" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u: User) => (
            <tr
              key={u.id}
              style={{
                borderBottom: "1px solid #eee",
                background: selectedUserId === u.id ? "#f0f7ff" : "transparent",
                cursor: "pointer",
              }}
              onClick={() => setSelectedUserId(u.id)}
            >
              <td style={{ padding: "0.5rem" }}>{u.id}</td>
              <td style={{ padding: "0.5rem" }}>{u.name}</td>
              <td style={{ padding: "0.5rem" }}>{u.email}</td>
              <td
                style={{
                  padding: "0.5rem",
                  color: "#999",
                  fontSize: "0.85rem",
                }}
              >
                {u.created_at}
              </td>
              <td style={{ padding: "0.5rem" }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    doDeleteUser(u.id);
                  }}
                  style={{
                    color: "red",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Add User</h3>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <form
        onSubmit={handleCreate}
        style={{ display: "flex", gap: "0.5rem", marginBottom: "2rem" }}
      >
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: "0.4rem" }}
        />
        <input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: "0.4rem" }}
        />
        <button
          type="submit"
          disabled={isCreating}
          style={{ padding: "0.4rem 1rem" }}
        >
          {isCreating ? "Creating…" : "Create"}
        </button>
      </form>

      {selectedUserId && <TodosSection userId={selectedUserId} />}
    </div>
  );
}

// ── Todos Section ──

function TodosSection({ userId }: { userId: number }) {
  const [title, setTitle] = useState("");

  const { data: todos = [], isLoading } = useQuery(getTodos, userId);

  const queryClient = useQueryClient();
  const { mutateAsync: doCreateTodo } = useMutation({
    mutationFn: createTodo,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: getFnQueryKey(getTodos, userId),
      });
    },
  });

  const { mutateAsync: doToggleTodo } = useMutation({
    mutationFn: toggleTodo,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: getFnQueryKey(getTodos, userId),
      });
    },
  });

  const { mutateAsync: doDeleteTodo } = useMutation({
    mutationFn: deleteTodo,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: getFnQueryKey(getTodos, userId),
      });
    },
  });

  async function handleAdd(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!title) return;
    await doCreateTodo({ userId, title });
    setTitle("");
  }

  if (isLoading) return <p>Loading todos…</p>;

  return (
    <div
      style={{ background: "#f9f9f9", padding: "1.5rem", borderRadius: "8px" }}
    >
      <h3>Todos for User #{userId}</h3>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {todos.map((t: Todo) => (
          <li
            key={t.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.4rem 0",
              borderBottom: "1px solid #eee",
            }}
          >
            <input
              type="checkbox"
              checked={t.completed === 1}
              onChange={() => doToggleTodo(t.id)}
            />
            <span
              style={{
                textDecoration: t.completed ? "line-through" : "none",
                flex: 1,
                color: t.completed ? "#999" : "inherit",
              }}
            >
              {t.title}
            </span>
            <button
              type="button"
              onClick={() => doDeleteTodo(t.id)}
              style={{
                color: "red",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "0.8rem",
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={handleAdd}
        style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}
      >
        <input
          placeholder="New todo…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ padding: "0.4rem", flex: 1 }}
        />
        <button type="submit" style={{ padding: "0.4rem 1rem" }}>
          Add
        </button>
      </form>
    </div>
  );
}

// ── Routes ──

const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: UsersPage,
});

export const routeTree = rootRoute.addChildren([usersRoute]);
