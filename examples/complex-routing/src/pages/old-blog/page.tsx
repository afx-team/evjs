import { redirect } from "@evjs/ev/navigation";

export function beforeLoad() {
  throw redirect({ to: "/posts" });
}

export default function OldBlogRedirect() {
  return null;
}
