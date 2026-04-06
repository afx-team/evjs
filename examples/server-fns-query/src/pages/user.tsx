import { createRoute, ServerFunctionError, useQuery } from "@evjs/client";
import { getUser } from "../api/users.server";
import { rootRoute } from "./__root";

function UserDetailPage() {
  const { userId } = userDetailRoute.useParams();
  const { data: user, error, isLoading } = useQuery(getUser, userId);

  if (isLoading) return <p>Loading user…</p>;

  if (error) {
    const isServerError = error instanceof ServerFunctionError;
    return (
      <div id="user-error">
        <h2>Error Loading User</h2>
        <p id="error-message">{error.message}</p>
        {isServerError && (
          <p id="error-type">ServerFunctionError (status: {error.status})</p>
        )}
      </div>
    );
  }

  if (!user) return null;

  return (
    <div id="user-detail">
      <h2>User Detail</h2>
      <p id="user-name">Name: {user.name}</p>
      <p id="user-email">Email: {user.email}</p>
    </div>
  );
}

export const userDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/user/$userId",
  component: UserDetailPage,
});
