export const CROWN_DURATION_SECONDS = 14_400;
export const CROWN_SLOT_START_OFFSETS = [
  0, 14_400, 28_800, 43_200, 57_600, 72_000,
] as const;

export type CrownSlot = {
  startTimestamp: number;
  endTimestamp: number;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** Convert the calendar's displayed date to a UTC date key. */
export function dateKeyFromCalendarDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dateKeyFromTimestamp(timestamp: number) {
  const date = new Date(timestamp * 1000);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Derive midnight UTC without using the browser's local timezone. */
export function timestampFromDateKey(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error("Invalid Crown date");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Math.floor(Date.UTC(year, month - 1, day) / 1000);
  const check = new Date(timestamp * 1000);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error("Invalid Crown date");
  }
  return timestamp;
}

/** Date object used only to render the selected day in react-day-picker. */
export function pickerDateFromKey(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error("Invalid Crown date");
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function buildCanonicalSlots(
  dateKey: string,
  durationSeconds = CROWN_DURATION_SECONDS,
): CrownSlot[] {
  const dateStart = timestampFromDateKey(dateKey);
  return CROWN_SLOT_START_OFFSETS.map((offset) => {
    const startTimestamp = dateStart + offset;
    return {
      startTimestamp,
      endTimestamp: startTimestamp + durationSeconds,
    };
  });
}
