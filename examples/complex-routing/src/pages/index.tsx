import { Link } from "@evjs/ev/page";

export default function HomePage() {
  return (
    <div>
      <h1>evjs Complex Routing Example</h1>
      <p>
        Demonstrates page routing, dynamic params, search params, redirects, and
        server function data.
      </p>
      <ul>
        <li>
          <Link to="/posts">Posts</Link> - post list and dynamic{" "}
          <code>$postId</code> pages
        </li>
        <li>
          <Link to="/dashboard">Dashboard</Link> - server function data
        </li>
        <li>
          <Link to="/search" search={{ q: "tutorial" }}>
            Search
          </Link>{" "}
          - search params
        </li>
        <li>
          <Link to="/old-blog">Old Blog</Link> - redirect to /posts
        </li>
      </ul>
    </div>
  );
}
