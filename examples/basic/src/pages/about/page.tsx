import { RouteCard } from "./components/RouteCard";

export default function AboutPage() {
  return (
    <RouteCard>
      <h2>Static Route</h2>
      <p>
        The <code>about</code> Page lives at{" "}
        <code>src/pages/about/page.tsx</code>; its directory maps to{" "}
        <code>/about</code>.
      </p>
    </RouteCard>
  );
}
