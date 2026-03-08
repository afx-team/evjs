"use server";

// ── Mock data ──

const posts = [
  {
    id: "1",
    title: "Getting Started with evjs",
    body: "evjs is a zero-config React meta-framework...",
    author: "alice",
    tags: ["intro", "tutorial"],
  },
  {
    id: "2",
    title: "Server Functions Deep Dive",
    body: 'Server functions use the "use server" directive...',
    author: "bob",
    tags: ["server", "advanced"],
  },
  {
    id: "3",
    title: "Routing Patterns",
    body: "evjs uses TanStack Router for type-safe routing...",
    author: "alice",
    tags: ["routing", "tutorial"],
  },
  {
    id: "4",
    title: "WebSocket Transport",
    body: "You can swap HTTP for WebSocket transport...",
    author: "charlie",
    tags: ["transport", "advanced"],
  },
  {
    id: "5",
    title: "Deploying to Edge",
    body: "Run your evjs app on Deno, Bun, or Workers...",
    author: "bob",
    tags: ["deploy", "edge"],
  },
];

const users: Record<string, { name: string; bio: string }> = {
  alice: { name: "Alice", bio: "Core contributor" },
  bob: { name: "Bob", bio: "Technical writer" },
  charlie: { name: "Charlie", bio: "DevOps engineer" },
};

// ── Server functions ──

export async function getPosts(query?: string) {
  await delay(50);
  if (!query) return posts;
  const q = query.toLowerCase();
  return posts.filter(
    (p) =>
      p.title.toLowerCase().includes(q) || p.tags.some((t) => t.includes(q)),
  );
}

export async function getPost(id: string) {
  await delay(50);
  const post = posts.find((p) => p.id === id);
  if (!post) throw new Error(`Post ${id} not found`);
  return post;
}

export async function getUser(username: string) {
  await delay(50);
  const user = users[username];
  if (!user) throw new Error(`User ${username} not found`);
  return { username, ...user };
}

export async function getStats() {
  await delay(50);
  return {
    totalPosts: posts.length,
    totalUsers: Object.keys(users).length,
    tags: [...new Set(posts.flatMap((p) => p.tags))],
  };
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
