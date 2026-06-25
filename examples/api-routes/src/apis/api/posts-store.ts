/** Simulated post database shared by colocated server route modules. */
export interface Post {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

export const posts: Post[] = [
  {
    id: "1",
    title: "Hello World",
    body: "Welcome to evjs route handlers!",
    createdAt: new Date().toISOString(),
  },
  {
    id: "2",
    title: "REST is not dead",
    body: "Route handlers bring REST APIs to evjs.",
    createdAt: new Date().toISOString(),
  },
];

let nextId = 3;

export function createPost(input: { title: string; body: string }): Post {
  const post: Post = {
    id: String(nextId++),
    title: input.title,
    body: input.body,
    createdAt: new Date().toISOString(),
  };
  posts.push(post);
  return post;
}
