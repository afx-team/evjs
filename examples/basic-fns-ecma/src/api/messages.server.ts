"use server";

/** Simulated message store. */
const messages: { id: string; text: string; timestamp: string }[] = [
  {
    id: "1",
    text: "Hello from the ECMA runtime!",
    timestamp: new Date().toISOString(),
  },
  {
    id: "2",
    text: "This server runs on any Fetch-compatible runtime.",
    timestamp: new Date().toISOString(),
  },
];

/** Get all messages. */
export async function getMessages() {
  await new Promise((r) => setTimeout(r, 50));
  return messages;
}

/** Post a new message. */
export async function postMessage(text: string) {
  await new Promise((r) => setTimeout(r, 50));
  const msg = {
    id: String(messages.length + 1),
    text,
    timestamp: new Date().toISOString(),
  };
  messages.push(msg);
  return msg;
}
