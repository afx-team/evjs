/**
 * E2E test for FaaS / server-only mode.
 *
 * Tests the pure backend API server with no browser UI.
 * Verifies that:
 * 1. The server builds and starts successfully in server-only mode
 * 2. Server functions are callable via POST /api/fn
 * 3. Request/response encoding works correctly
 * 4. Error handling works for unknown functions
 */

import path from "node:path";
import { createFaasTest, expect } from "../fixtures-faas-only";

const test = createFaasTest("faas-only");

// In FaaS mode, function IDs are human-readable: "relativePath#exportName"
const exampleDir = path.resolve(
  import.meta.dirname,
  "..",
  "examples",
  "faas-only",
);

test.describe("faas-only", () => {
  test("calls hello server function", async ({ request, apiURL }) => {
    const response = await request.post(`${apiURL}/api/fn`, {
      data: {
        fnId: "src/api/hello.server#hello",
        args: ["World"],
      },
    });

    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.result).toBe("Hello, World! 👋");
  });

  test("calls getServerTime server function", async ({ request, apiURL }) => {
    const response = await request.post(`${apiURL}/api/fn`, {
      data: {
        fnId: "src/api/hello.server#getServerTime",
        args: [],
      },
    });

    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.result).toHaveProperty("timestamp");
    expect(body.result).toHaveProperty("uptime");
    expect(typeof body.result.timestamp).toBe("string");
    expect(typeof body.result.uptime).toBe("number");
  });

  test("calls CRUD todo functions", async ({ request, apiURL }) => {
    // List todos (empty initially)
    const listRes1 = await request.post(`${apiURL}/api/fn`, {
      data: {
        fnId: "src/api/todos.server#listTodos",
        args: [],
      },
    });
    expect(listRes1.ok()).toBe(true);
    const list1 = await listRes1.json();
    expect(list1.result).toEqual([]);

    // Create a todo
    const createRes = await request.post(`${apiURL}/api/fn`, {
      data: {
        fnId: "src/api/todos.server#createTodo",
        args: ["Buy groceries"],
      },
    });
    expect(createRes.ok()).toBe(true);
    const created = await createRes.json();
    expect(created.result.title).toBe("Buy groceries");
    expect(created.result.completed).toBe(false);
    expect(created.result.id).toBeDefined();

    const todoId = created.result.id;

    // List todos (should have one)
    const listRes2 = await request.post(`${apiURL}/api/fn`, {
      data: {
        fnId: "src/api/todos.server#listTodos",
        args: [],
      },
    });
    const list2 = await listRes2.json();
    expect(list2.result).toHaveLength(1);
    expect(list2.result[0].title).toBe("Buy groceries");

    // Toggle todo
    const toggleRes = await request.post(`${apiURL}/api/fn`, {
      data: {
        fnId: "src/api/todos.server#toggleTodo",
        args: [todoId],
      },
    });
    expect(toggleRes.ok()).toBe(true);
    const toggled = await toggleRes.json();
    expect(toggled.result.completed).toBe(true);

    // Delete todo
    const deleteRes = await request.post(`${apiURL}/api/fn`, {
      data: {
        fnId: "src/api/todos.server#deleteTodo",
        args: [todoId],
      },
    });
    expect(deleteRes.ok()).toBe(true);
    const deleted = await deleteRes.json();
    expect(deleted.result.deleted).toBe(true);

    // List todos (empty again)
    const listRes3 = await request.post(`${apiURL}/api/fn`, {
      data: {
        fnId: "src/api/todos.server#listTodos",
        args: [],
      },
    });
    const list3 = await listRes3.json();
    expect(list3.result).toEqual([]);
  });

  test("returns 404 for unknown function", async ({ request, apiURL }) => {
    const response = await request.post(`${apiURL}/api/fn`, {
      data: {
        fnId: "nonexistent_function_id",
        args: [],
      },
    });

    // dispatch returns 404 for unknown functions
    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.error).toContain("not found");
  });

  test("returns 400 for missing fnId", async ({ request, apiURL }) => {
    const response = await request.post(`${apiURL}/api/fn`, {
      data: {
        args: [],
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("fnId");
  });

  test("does not produce a client bundle", async () => {
    // Verify no dist/client directory exists in FaaS mode
    const fs = await import("node:fs");
    const clientDir = path.resolve(exampleDir, "dist", "client");
    expect(fs.existsSync(clientDir)).toBe(false);
  });
});
