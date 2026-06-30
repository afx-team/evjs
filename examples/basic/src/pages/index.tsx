import { Link } from "@evjs/ev/navigation";
import {
  getFnQueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@evjs/ev/query";
import { useState } from "react";
import { createUser, getUsers } from "@/apis/users.server";

const cardStyle = {
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: "1rem",
};

const linkStyle = { color: "#2563eb", textDecoration: "none" };

export default function UsersPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const queryClient = useQueryClient();

  const { data: users = [], isLoading } = useQuery(getUsers);
  const createUserMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
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

  if (isLoading) return <p>Loading users from server...</p>;

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div style={cardStyle}>
        <h2>Routing Patterns</h2>
        <p style={{ color: "#475569" }}>
          Page files cover static, dynamic-param, and search-param pages with
          framework-managed routing glue.
        </p>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <Link to="/about" style={linkStyle}>
            Open static route
          </Link>
          <Link to="/users/$userId" params={{ userId: "2" }} style={linkStyle}>
            Open dynamic route
          </Link>
          <Link to="/search" search={{ tab: "favorites" }} style={linkStyle}>
            Open search route
          </Link>
        </div>
      </div>

      <div style={cardStyle}>
        <h2>Users</h2>
        <ul>
          {users.map((u) => (
            <li key={u.id}>
              <Link
                to="/users/$userId"
                params={{ userId: u.id }}
                style={linkStyle}
              >
                {u.name}
              </Link>{" "}
              - {u.email}
            </li>
          ))}
        </ul>

        <h3>Add User</h3>
        <form
          onSubmit={handleCreate}
          style={{ display: "flex", gap: "0.5rem" }}
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
          <button type="submit">Create</button>
        </form>
      </div>
    </div>
  );
}
