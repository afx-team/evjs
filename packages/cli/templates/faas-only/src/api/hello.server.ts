"use server";

/**
 * Example: Hello World server function.
 *
 * This function is automatically registered and accessible via the
 * server function endpoint (POST /api/fn).
 */
export async function hello(name: string): Promise<string> {
  return `Hello, ${name}! 👋`;
}

/**
 * Example: Get current server time.
 */
export async function getServerTime(): Promise<{
  timestamp: string;
  uptime: number;
}> {
  return {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };
}
