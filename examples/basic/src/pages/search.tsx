import { Link, usePageSearch, useQuery } from "@evjs/client";
import { getUsers } from "../api/users.server";

const cardStyle = {
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: "1rem",
};

const linkStyle = { color: "#2563eb", textDecoration: "none" };

export function validateSearch(search: Record<string, unknown>) {
  return {
    tab:
      search.tab === "favorites" || search.tab === "recent"
        ? search.tab
        : "all",
  };
}

export default function SearchPage() {
  const search = usePageSearch();
  const tab =
    search.tab === "favorites" || search.tab === "recent" ? search.tab : "all";
  const { data: users = [] } = useQuery(getUsers);

  const visibleUsers =
    tab === "favorites"
      ? users.filter((user) => Number.parseInt(user.id, 10) % 2 === 1)
      : tab === "recent"
        ? users.slice(-2)
        : users;

  return (
    <div style={cardStyle}>
      <h2>Search Route</h2>
      <p style={{ color: "#64748b" }}>Current search tab: {tab}</p>
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <Link to="/search" search={{ tab: "all" }} style={linkStyle}>
          All
        </Link>
        <Link to="/search" search={{ tab: "favorites" }} style={linkStyle}>
          Favorites
        </Link>
        <Link to="/search" search={{ tab: "recent" }} style={linkStyle}>
          Recent
        </Link>
      </div>
      <ul>
        {visibleUsers.map((user) => (
          <li key={user.id}>
            {user.name} - {user.email}
          </li>
        ))}
      </ul>
    </div>
  );
}
