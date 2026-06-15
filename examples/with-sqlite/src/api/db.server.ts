"use server";

import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { ServerError } from "@evjs/server";

/**
 * SQLite database connection using Node.js built-in sqlite module.
 *
 * Creates a `data.db` file in the project root.
 * In production, configure the path via environment variables.
 */
const db = new DatabaseSync(path.resolve(process.cwd(), "data.db"));

// Enable WAL mode for better concurrent read performance
db.exec("PRAGMA journal_mode = WAL");

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
const userCount = readNumber(
  db.prepare("SELECT COUNT(*) as count FROM users").get(),
  "count",
  "users count",
);
if (userCount === 0) {
  const insertUser = db.prepare(
    "INSERT INTO users (name, email) VALUES (?, ?)",
  );
  const insertTodo = db.prepare(
    "INSERT INTO todos (user_id, title, completed) VALUES (?, ?, ?)",
  );

  insertUser.run("Alice", "alice@example.com");
  insertUser.run("Bob", "bob@example.com");
  insertUser.run("Charlie", "charlie@example.com");

  insertTodo.run(1, "Write documentation", 1);
  insertTodo.run(1, "Review pull request", 0);
  insertTodo.run(2, "Fix bug #42", 0);
  insertTodo.run(3, "Deploy to staging", 1);
  insertTodo.run(3, "Update dependencies", 0);
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
  return db
    .prepare("SELECT * FROM users ORDER BY id")
    .all()
    .map((row) => readUser(row));
}

/** Get a single user by ID. */
export async function getUser(id: number): Promise<User> {
  const user = readOptionalUser(
    db.prepare("SELECT * FROM users WHERE id = ?").get(id),
  );
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
    db.prepare("INSERT INTO users (name, email) VALUES (?, ?)").run(
      data.name,
      data.email,
    );
    const lastId = readNumber(
      db.prepare("SELECT last_insert_rowid() as id").get(),
      "id",
      "last inserted user id",
    );
    return await getUser(lastId);
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
    .all(userId)
    .map((row) => readTodo(row));
}

/** Create a todo for a user. */
export async function createTodo(data: {
  userId: number;
  title: string;
}): Promise<Todo> {
  await getUser(data.userId);

  db.prepare("INSERT INTO todos (user_id, title) VALUES (?, ?)").run(
    data.userId,
    data.title,
  );
  const lastId = readNumber(
    db.prepare("SELECT last_insert_rowid() as id").get(),
    "id",
    "last inserted todo id",
  );

  return readTodo(
    db.prepare("SELECT * FROM todos WHERE id = ?").get(lastId),
    "created todo",
  );
}

/** Toggle a todo's completed status. */
export async function toggleTodo(id: number): Promise<Todo> {
  db.prepare("UPDATE todos SET completed = NOT completed WHERE id = ?").run(id);
  const todo = readOptionalTodo(
    db.prepare("SELECT * FROM todos WHERE id = ?").get(id),
  );
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

type SqlRow = Record<string, SQLOutputValue>;

function readUser(row: SqlRow | undefined, source = "user row"): User {
  if (!row) throw new Error(`[with-sqlite] Missing ${source}.`);
  return {
    id: readNumber(row, "id", source),
    name: readString(row, "name", source),
    email: readString(row, "email", source),
    created_at: readString(row, "created_at", source),
  };
}

function readOptionalUser(row: SqlRow | undefined): User | undefined {
  return row ? readUser(row) : undefined;
}

function readTodo(row: SqlRow | undefined, source = "todo row"): Todo {
  if (!row) throw new Error(`[with-sqlite] Missing ${source}.`);
  return {
    id: readNumber(row, "id", source),
    user_id: readNumber(row, "user_id", source),
    title: readString(row, "title", source),
    completed: readNumber(row, "completed", source),
    created_at: readString(row, "created_at", source),
  };
}

function readOptionalTodo(row: SqlRow | undefined): Todo | undefined {
  return row ? readTodo(row) : undefined;
}

function readNumber(
  row: SqlRow | undefined,
  key: string,
  source: string,
): number {
  const value = readValue(row, key, source);
  if (typeof value === "number") return value;
  throw createColumnError(source, key, "number", value);
}

function readString(
  row: SqlRow | undefined,
  key: string,
  source: string,
): string {
  const value = readValue(row, key, source);
  if (typeof value === "string") return value;
  throw createColumnError(source, key, "string", value);
}

function readValue(
  row: SqlRow | undefined,
  key: string,
  source: string,
): SQLOutputValue | undefined {
  if (!row) throw new Error(`[with-sqlite] Missing ${source}.`);
  return row[key];
}

function createColumnError(
  source: string,
  key: string,
  expected: string,
  value: SQLOutputValue | undefined,
): Error {
  return new Error(
    `[with-sqlite] Expected ${source}.${key} to be a ${expected}, got ${typeof value}.`,
  );
}
