"use server";

import { ServerError } from "@evjs/runtime/server";

/** Simulated user database. */
const users = [
  { id: "1", name: "Alice", email: "alice@example.com" },
  { id: "2", name: "Bob", email: "bob@example.com" },
  { id: "3", name: "Charlie", email: "charlie@example.com" },
];

/** Get all users. */
export async function getUsers() {
  // Simulate server latency
  await new Promise((r) => setTimeout(r, 100));
  return users;
}

/** Get a single user by ID. Throws ServerError if not found. */
export async function getUser(id: string) {
  await new Promise((r) => setTimeout(r, 50));
  const user = users.find((u) => u.id === id);
  if (!user) {
    throw new ServerError("User not found", { status: 404, data: { id } });
  }
  return user;
}

/** Search users by name and email (multi-arg). */
export async function searchUsers(name: string, email: string) {
  await new Promise((r) => setTimeout(r, 50));
  return users.filter((u) => {
    const matchName = name
      ? u.name.toLowerCase().includes(name.toLowerCase())
      : true;
    const matchEmail = email
      ? u.email.toLowerCase().includes(email.toLowerCase())
      : true;
    return matchName && matchEmail;
  });
}

/** Create a new user. */
export async function createUser(data: { name: string; email: string }) {
  await new Promise((r) => setTimeout(r, 50));
  const newUser = { id: String(users.length + 1), ...data };
  users.push(newUser);
  return newUser;
}
