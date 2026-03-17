"use server";

import path from "node:path";
import { ServerError } from "@evjs/runtime/server";
import Database from "better-sqlite3";

/**
 * SQLite database connection.
 *
 * Creates a `data.db` file in the project root.
 * In production, configure the path via environment variables.
 */
const db = new Database(path.resolve(process.cwd(), "data.db"));

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");

// Create tables on first run
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Seed with sample data if empty
const count = db.prepare("SELECT COUNT(*) as count FROM users").get() as {
  count: number;
};
if (count.count === 0) {
  const insertUser = db.prepare(
    "INSERT INTO users (name, email) VALUES (?, ?)",
  );
  const insertTodo = db.prepare(
    "INSERT INTO todos (user_id, title, completed) VALUES (?, ?, ?)",
  );

  const seedData = db.transaction(() => {
    insertUser.run("Alice", "alice@example.com");
    insertUser.run("Bob", "bob@example.com");
    insertUser.run("Charlie", "charlie@example.com");

    insertTodo.run(1, "Write documentation", 1);
    insertTodo.run(1, "Review pull request", 0);
    insertTodo.run(2, "Fix bug #42", 0);
    insertTodo.run(3, "Deploy to staging", 1);
    insertTodo.run(3, "Update dependencies", 0);
  });

  seedData();
}

// ── User queries ──

export interface User {
  id: number;
  name: string;
  email: string;
  created_at: string;
}

/** Get all users. */
export async function getUsers(): Promise<User[]> {
  return db.prepare("SELECT * FROM users ORDER BY id").all() as User[];
}

/** Get a single user by ID. */
export async function getUser(id: number): Promise<User> {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | User
    | undefined;
  if (!user) {
    throw new ServerError("User not found", { status: 404, data: { id } });
  }
  return user;
}

/** Create a new user. */
export async function createUser(data: {
  name: string;
  email: string;
}): Promise<User> {
  try {
    const result = db
      .prepare("INSERT INTO users (name, email) VALUES (?, ?)")
      .run(data.name, data.email);
    return (await getUser(Number(result.lastInsertRowid))) as User;
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      throw new ServerError("Email already exists", {
        status: 409,
        data: { email: data.email },
      });
    }
    throw e;
  }
}

/** Delete a user and their todos. */
export async function deleteUser(id: number): Promise<void> {
  const result = db.prepare("DELETE FROM users WHERE id = ?").run(id);
  if (result.changes === 0) {
    throw new ServerError("User not found", { status: 404, data: { id } });
  }
}

// ── Todo queries ──

export interface Todo {
  id: number;
  user_id: number;
  title: string;
  completed: number;
  created_at: string;
}

/** Get todos for a user. */
export async function getTodos(userId: number): Promise<Todo[]> {
  return db
    .prepare("SELECT * FROM todos WHERE user_id = ? ORDER BY id")
    .all(userId) as Todo[];
}

/** Create a todo for a user. */
export async function createTodo(data: {
  userId: number;
  title: string;
}): Promise<Todo> {
  // Verify user exists
  await getUser(data.userId);

  const result = db
    .prepare("INSERT INTO todos (user_id, title) VALUES (?, ?)")
    .run(data.userId, data.title);

  return db
    .prepare("SELECT * FROM todos WHERE id = ?")
    .get(result.lastInsertRowid) as Todo;
}

/** Toggle a todo's completed status. */
export async function toggleTodo(id: number): Promise<Todo> {
  db.prepare("UPDATE todos SET completed = NOT completed WHERE id = ?").run(id);
  const todo = db.prepare("SELECT * FROM todos WHERE id = ?").get(id) as
    | Todo
    | undefined;
  if (!todo) {
    throw new ServerError("Todo not found", { status: 404, data: { id } });
  }
  return todo;
}

/** Delete a todo. */
export async function deleteTodo(id: number): Promise<void> {
  const result = db.prepare("DELETE FROM todos WHERE id = ?").run(id);
  if (result.changes === 0) {
    throw new ServerError("Todo not found", { status: 404, data: { id } });
  }
}
