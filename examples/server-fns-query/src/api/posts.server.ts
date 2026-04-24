"use server";

/** Simulated posts database. */
const posts = [
  {
    id: "101",
    title: "Hello evjs",
    content: "Building a custom evjs plugin",
  },
  {
    id: "102",
    title: "Server Functions",
    content: "Zero config RPC is awesome",
  },
];

/** Get all posts. */
export async function getPosts() {
  await new Promise((r) => setTimeout(r, 100));
  return posts;
}

/** Create a new post. */
export async function createPost(data: { title: string; content: string }) {
  await new Promise((r) => setTimeout(r, 50));
  const newPost = { id: String(posts.length + 101), ...data };
  posts.push(newPost);
  return newPost;
}
