/** Await every task, including after failures, and return their rejection reasons. */
export async function rejections(tasks: Iterable<unknown>): Promise<unknown[]> {
  return (await Promise.allSettled(tasks)).flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
}
