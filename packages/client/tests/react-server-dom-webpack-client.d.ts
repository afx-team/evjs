declare module "react-server-dom-webpack/client" {
  import type { ReactNode } from "react";

  export function createFromFetch(
    response: Promise<Response>,
    options?: {
      moduleBaseURL?: string;
    },
  ): ReactNode;
}
