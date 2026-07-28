import { Link } from "@evjs/ev/navigation";
import { useQuery } from "@evjs/ev/query";
import { usePageParams } from "@evjs/ev/route";
import { getUser } from "@/apis/data.server";

const styles = {
  card: { border: "1px solid #e5e7eb", borderRadius: 8, padding: "1rem" },
};

export default function UserProfile() {
  const { username } = usePageParams();
  const { data: user } = useQuery(getUser, username);

  if (!user) return <p>Loading...</p>;
  return (
    <div style={styles.card}>
      <h2>{user.name}</h2>
      <p style={{ color: "#6b7280" }}>@{user.username}</p>
      <p>{user.bio}</p>
      <Link to="/posts">Back to posts</Link>
    </div>
  );
}
