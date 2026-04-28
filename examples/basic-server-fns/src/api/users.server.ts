"use server";

import { getCookie, headers, setCookie, waitUntil } from "@evjs/server";

/** Simulated user database. */
const users = [
  { id: "1", name: "Alice", email: "alice@example.com" },
  { id: "2", name: "Bob", email: "bob@example.com" },
  { id: "3", name: "Charlie", email: "charlie@example.com" },
];

/** Get all users. */
export async function getUsers() {
  const reqHeaders = headers();
  const userAgent = reqHeaders.get("user-agent") || "unknown";

  // Track visits via cookies
  const visits = Number.parseInt(getCookie("visits") || "0", 10) + 1;
  setCookie("visits", String(visits), { maxAge: 60 * 60 * 24 });

  // Fire-and-forget background task
  waitUntil(
    new Promise((resolve) => {
      setTimeout(() => {
        console.log(
          `[Analytics] users fetched by user-agent: ${userAgent}, visit count: ${visits}`,
        );
        resolve(undefined);
      }, 100);
    }),
  );

  // Simulate server latency
  await new Promise((r) => setTimeout(r, 100));
  return users;
}

/** Get a single user by ID. */
export async function getUser(id: string) {
  await new Promise((r) => setTimeout(r, 50));
  const user = users.find((u) => u.id === id);
  if (!user) throw new Error(`User ${id} not found`);
  return user;
}

/** Create a new user. */
export async function createUser(data: { name: string; email: string }) {
  await new Promise((r) => setTimeout(r, 50));
  const newUser = { id: String(users.length + 1), ...data };
  users.push(newUser);
  return newUser;
}
