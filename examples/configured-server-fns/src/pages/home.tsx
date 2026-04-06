import {
  createRoute,
  getFnQueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@evjs/client";
import { useState } from "react";
import { createUser, getUsers } from "../api/users.server";
import { rootRoute } from "./__root";

function UsersPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const { data: users = [], isLoading } = useQuery(getUsers);

  const queryClient = useQueryClient();
  const { mutateAsync: doCreateUser } = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getFnQueryKey(getUsers) });
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

export const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: UsersPage,
});
