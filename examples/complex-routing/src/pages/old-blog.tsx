import { redirect } from "@evjs/client";

export function beforeLoad() {
  throw redirect({ to: "/posts" });
}

export default function OldBlogRedirect() {
  return null;
}
