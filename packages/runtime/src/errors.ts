/**
 * Error thrown when a server function call fails.
 */
export class ServerFunctionError extends Error {
  /** The unique function ID. */
  readonly fnId: string;
  /** HTTP status code from the server. */
  readonly status: number;

  constructor(message: string, fnId: string, status: number, cause?: Error) {
    super(message);
    this.name = "ServerFunctionError";
    this.fnId = fnId;
    this.status = status;
    if (cause) this.cause = cause;
  }
}
