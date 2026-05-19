import { getGreeting } from "../data.server";

export const greetingQuery = {
  queryKey: ["greeting"],
  queryFn: getGreeting,
  staleTime: 60_000,
};
