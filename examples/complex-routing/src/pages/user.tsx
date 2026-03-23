import { createRoute, Link, useQuery } from "@evjs/client";
import { getUser } from "../api/data.server";
import { rootRoute } from "./__root";

const styles = {
  card: { border: "1px solid #e5e7eb", borderRadius: 8, padding: "1rem" },
};

function UserProfile() {
  const { username } = userRoute.useParams();
  const { data: user } = useQuery(getUser, username);

  if (!user) return <p>Loading...</p>;
  return (
    <div style={styles.card}>
      <h2>{user.name}</h2>
      <p style={{ color: "#6b7280" }}>@{user.username}</p>
      <p>{user.bio}</p>
      <Link to="/posts">← Back to posts</Link>
    </div>
  );
}

export const userRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/users/$username",
  component: UserProfile,
});
