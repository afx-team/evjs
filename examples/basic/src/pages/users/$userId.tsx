import { Link, usePageParams, useQuery } from "@evjs/ev/page";
import { getUser } from "../../api/users.server";

const cardStyle = {
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: "1rem",
};

const linkStyle = { color: "#2563eb", textDecoration: "none" };

export default function UserDetailPage() {
  const { userId } = usePageParams();
  const { data: user, isLoading } = useQuery(getUser, userId);

  if (isLoading) return <p>Loading user...</p>;

  return (
    <div style={cardStyle}>
      <h2>Dynamic Route</h2>
      <p style={{ color: "#64748b" }}>Path param: {userId}</p>
      <p>
        Selected user: <strong>{user?.name}</strong>
      </p>
      <p>{user?.email}</p>
      <Link to="/" style={linkStyle}>
        Back to users
      </Link>
    </div>
  );
}
