"use server";

import { headers } from "@evjs/server";

export async function getGreeting() {
  return {
    message: headers().get("x-evjs-e2e") ?? "SSR data loaded",
  };
}
