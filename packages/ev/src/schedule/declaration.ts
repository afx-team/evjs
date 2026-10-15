/** Static scheduling metadata read by the build; no timer is started locally. */
export interface ScheduleOptions {
  /** Stable identity; defaults to the named export. */
  id?: string;
  cron: string;
  disable?: boolean;
}

export function defineSchedule<T extends () => unknown>(
  _options: ScheduleOptions,
  handler: T,
): T {
  return handler;
}
