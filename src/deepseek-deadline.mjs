export const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function scheduleDeepSeekDeadline(callback, remainingMs, schedule = setTimeout) {
  const delay = Math.max(1, Math.min(MAX_TIMER_DELAY_MS, remainingMs));
  return schedule(callback, delay);
}
