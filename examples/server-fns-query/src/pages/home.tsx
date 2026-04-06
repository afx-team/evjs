import {
  createRoute,
  getFnQueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@evjs/client";
import { useState } from "react";
import { createPost, getPosts } from "../api/posts.server";
import { createUser, getUsers } from "../api/users.server";
import { rootRoute } from "./__root";

function UsersPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const { data: users = [], isLoading: isLoadingUsers } = useQuery(getUsers);

  const queryClient = useQueryClient();
  const { mutateAsync: createUserMutation } = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getFnQueryKey(getUsers) });
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

  const { data: posts = [], isLoading: isLoadingPosts } = useQuery(getPosts);

  const { mutateAsync: createPostMutation } = useMutation({
    mutationFn: createPost,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getFnQueryKey(getPosts) });
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
      <h2>Users</h2>
      <ul id="user-list">
        {users.map((u) => (
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
        {posts.map((p) => (
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

export const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: UsersPage,
});
