import { redirect } from "@evjs/ev/page";

export function beforeLoad() {
  throw redirect({ to: "/posts" });
}

export default function OldBlogRedirect() {
  return null;
}
