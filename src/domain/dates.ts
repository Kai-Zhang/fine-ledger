import { Temporal } from "@js-temporal/polyfill";
export const deviceTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export const timeZones = () => [
  ...new Set([
    deviceTimeZone(),
    "Asia/Shanghai",
    "Asia/Hong_Kong",
    "Asia/Tokyo",
    "America/Los_Angeles",
    "America/New_York",
    "Europe/London",
    "Europe/Berlin",
    "UTC",
    ...Intl.supportedValuesOf("timeZone"),
  ]),
];
export function localDate(
  value: string | Date = new Date(),
  timeZone = deviceTimeZone(),
) {
  return Temporal.Instant.from(
    typeof value === "string" ? value : value.toISOString(),
  )
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString();
}
export function dateOffset(day: string, days: number) {
  return Temporal.PlainDate.from(day).add({ days }).toString();
}
export function localInput(
  iso = new Date().toISOString(),
  timeZone = deviceTimeZone(),
) {
  return Temporal.Instant.from(iso)
    .toZonedDateTimeISO(timeZone)
    .toPlainDateTime()
    .toString({ smallestUnit: "second" });
}
export function displayTime(iso: string, timeZone = deviceTimeZone()) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
export function dateToISO(
  input: string,
  previous?: string,
  timeZone = deviceTimeZone(),
) {
  if (previous && localInput(previous, timeZone) === input) return previous;
  try {
    return Temporal.PlainDateTime.from(input)
      .toZonedDateTime(timeZone, { disambiguation: "reject" })
      .toInstant()
      .toString({ smallestUnit: "millisecond" });
  } catch {
    throw Error("时间无效或遇到夏令时重复/跳过的时刻，请选择明确时间");
  }
}
export function endOfDay(day: string, timeZone = deviceTimeZone()) {
  return Temporal.PlainDate.from(day)
    .add({ days: 1 })
    .toZonedDateTime(timeZone)
    .toInstant()
    .subtract({ nanoseconds: 1 })
    .toString();
}
// Preserve ordering of imported microseconds; Date alone truncates the fraction.
export function compareTime(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "9999") return 1;
  if (b === "9999") return -1;
  const secondsA = Math.floor(new Date(a).getTime() / 1000),
    secondsB = Math.floor(new Date(b).getTime() / 1000);
  if (secondsA !== secondsB) return secondsA < secondsB ? -1 : 1;
  const fraction = (s: string) =>
    (s.match(/\.(\d+)/)?.[1] || "").padEnd(12, "0");
  return fraction(a).localeCompare(fraction(b));
}
export const sortEntries = <T extends { occurredAt: string; id: string }>(
  entries: T[],
) =>
  [...entries].sort(
    (a, b) =>
      compareTime(b.occurredAt, a.occurredAt) || b.id.localeCompare(a.id),
  );

export function startOfDay(day: string, timeZone = deviceTimeZone()) {
  return Temporal.PlainDate.from(day)
    .toZonedDateTime(timeZone)
    .toInstant()
    .toString();
}
