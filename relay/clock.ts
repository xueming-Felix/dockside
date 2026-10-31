// Sim clock helpers. Sim minutes count from DAY_START (08:00): 0 = 08:00, 360 = 14:00.
// Slots are 60 minutes. At speed 1, one real second is one sim minute ("60x").

export const DAY_START_MIN = 8 * 60; // 08:00 wall clock
export const SLOT_MIN = 60;
export const DEFAULT_SPEED = 1; // sim minutes per real second

/** simMin (minutes since 08:00) -> "HH:MM" wall clock */
export function hhmm(simMin: number): string {
  const t = DAY_START_MIN + simMin;
  const h = Math.floor(t / 60);
  const m = Math.floor(t % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "HH:MM" wall clock -> simMin (minutes since 08:00). "14:00" -> 360 */
export function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`bad HH:MM: ${s}`);
  return Number(m[1]) * 60 + Number(m[2]) - DAY_START_MIN;
}

/** simMin -> hour-aligned slot start <= simMin */
export function slotFloor(simMin: number): number {
  return Math.floor(simMin / SLOT_MIN) * SLOT_MIN;
}

/** smallest hour-aligned slot start >= simMin */
export function slotCeil(simMin: number): number {
  return Math.ceil(simMin / SLOT_MIN) * SLOT_MIN;
}
