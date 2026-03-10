"use server";

/**
 * Example: CRUD-style server functions for a simple Todo API.
 *
 * In a real FaaS app, you'd connect to a database here.
 */

interface Todo {
  id: string;
  title: string;
  completed: boolean;
}

// In-memory store (replace with DB in production)
const todos = new Map<string, Todo>();

export async function listTodos(): Promise<Todo[]> {
  return Array.from(todos.values());
}

export async function createTodo(title: string): Promise<Todo> {
  const todo: Todo = {
    id: crypto.randomUUID(),
    title,
    completed: false,
  };
  todos.set(todo.id, todo);
  return todo;
}

export async function toggleTodo(id: string): Promise<Todo> {
  const todo = todos.get(id);
  if (!todo) {
    throw new Error(`Todo ${id} not found`);
  }
  todo.completed = !todo.completed;
  return todo;
}

export async function deleteTodo(id: string): Promise<{ deleted: boolean }> {
  return { deleted: todos.delete(id) };
}
