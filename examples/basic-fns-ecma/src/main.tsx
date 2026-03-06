import {
  createApp,
  createRootRoute,
  createRoute,
  Link,
  Outlet,
} from "@evjs/runtime/client";
import { useEffect, useState } from "react";
import { getMessages, postMessage } from "./api/messages.server";

// ── Root Route ──

function Root() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <h1>ECMA Runtime Example</h1>
      <p style={{ color: "#666" }}>
        Server bundle is environment-agnostic — works in Node.js, Deno, Bun,
        Cloudflare Workers, or any Fetch-compatible runtime.
      </p>
      <nav style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <Link to="/">Messages</Link>
      </nav>
      <Outlet />
    </div>
  );
}

const rootRoute = createRootRoute({ component: Root });

// ── Messages Route ──

function MessagesPage() {
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<
    { id: string; text: string; timestamp: string }[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    getMessages()
      .then((data) => {
        if (mounted) {
          setMessages(data);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.error(err);
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function handlePost(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!text) return;
    try {
      await postMessage(text);
      setText("");
      const data = await getMessages();
      setMessages(data);
    } catch (err) {
      console.error(err);
    }
  }

  if (isLoading) return <p>Loading messages from server…</p>;

  return (
    <div>
      <h2>Messages (via server functions)</h2>
      <ul>
        {messages.map((m) => (
          <li key={m.id}>
            <strong>{m.text}</strong>
            <br />
            <small style={{ color: "#999" }}>{m.timestamp}</small>
          </li>
        ))}
      </ul>

      <h3>Post a Message</h3>
      <form onSubmit={handlePost} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          placeholder="Message"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}

const messagesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: MessagesPage,
});

// ── Mount ──

const routeTree = rootRoute.addChildren([messagesRoute]);

createApp({ routeTree }).render("#app");
