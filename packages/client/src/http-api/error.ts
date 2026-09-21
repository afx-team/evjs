/** HTTP or content-type failure from the opt-in JSON convenience reader. */
export class ApiError extends Error {
  readonly status: number;

  constructor(
    message: string,
    readonly response: Response,
    readonly url: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = response.status;
  }
}
