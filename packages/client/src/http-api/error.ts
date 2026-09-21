/** HTTP or content-type failure from the opt-in JSON convenience reader. */
export class ApiError extends Error {
  readonly status: number;

  constructor(
    message: string,
    readonly response: Response,
    readonly url: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApiError";
    this.status = response.status;
  }
}
