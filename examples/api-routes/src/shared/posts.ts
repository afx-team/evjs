/** HTTP DTOs shared with import type; runtime validation stays on the server. */
export interface CreatePostInput {
  title: string;
  body: string;
}

export interface Post extends CreatePostInput {
  id: string;
  createdAt: string;
}
