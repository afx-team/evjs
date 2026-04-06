import { createRoute, useQuery } from "@evjs/client";
import { useState } from "react";
import { searchUsers } from "../api/users.server";
import { rootRoute } from "./__root";

function SearchPage() {
  const [searchName, setSearchName] = useState("");
  const [searchEmail, setSearchEmail] = useState("");

  const { data: results, isLoading } = useQuery(
    searchUsers,
    searchName || "",
    searchEmail || "",
  );

  function handleSearch(e: { preventDefault: () => void }) {
    e.preventDefault();
  }

  return (
    <div>
      <h2>Search Users (multi-arg)</h2>
      <form
        onSubmit={handleSearch}
        style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}
      >
        <input
          placeholder="Name"
          id="search-name"
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
        />
        <input
          placeholder="Email"
          id="search-email"
          value={searchEmail}
          onChange={(e) => setSearchEmail(e.target.value)}
        />
        <button type="submit">Search</button>
      </form>

      {isLoading && <p>Searching…</p>}

      {results && (
        <div id="search-results">
          <p>Found {results.length} result(s)</p>
          <ul>
            {results.map((u) => (
              <li key={u.id}>
                {u.name} — {u.email}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  component: SearchPage,
});
