import { Link } from "@evjs/ev/navigation";
import { useQuery } from "@evjs/ev/query";
import { usePageParams } from "@evjs/ev/route";
import { getPost } from "@/apis/data.server";

const styles = {
  tag: {
    display: "inline-block",
    background: "#f3f4f6",
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 12,
    marginRight: 4,
  },
};

export default function PostDetail() {
  const { postId } = usePageParams();
  const { data: post } = useQuery(getPost, postId);

  if (!post) return <p>Loading...</p>;
  return (
    <div>
      <h2>{post.title}</h2>
      <p style={{ color: "#6b7280" }}>
        by{" "}
        <Link to="/users/$username" params={{ username: post.author }}>
          {post.author}
        </Link>
      </p>
      <p>{post.body}</p>
      <div>
        {post.tags.map((tag) => (
          <span key={tag} style={styles.tag}>
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}
