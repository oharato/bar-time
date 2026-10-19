/** Pure alert timing. All timestamps and durations are milliseconds. */
export const ALERT_DURATION = Object.freeze({ transition: 3000, complete: 10000 });

const validTime = value => typeof value === 'number' && Number.isFinite(value)
  && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const validKind = kind => typeof kind === 'string' && Object.hasOwn(ALERT_DURATION, kind);
const inactive = () => ({ active: false, ledOn: false, pulseIndex: -1, remainingMs: 0 });

/** Anchor to the actual event time, including when the UI notices it late. */
export function createAlert(kind, now) {
  if (!validKind(kind) || !validTime(now)) return null;
  const until = now + ALERT_DURATION[kind];
  if (!validTime(until)) return null;
  return { kind, startedAt: now, until };
}

/**
 * No queued pulses: the caller may play only the current unseen pulseIndex.
 * Each second has 500 ms LED-on, then 500 ms LED-off. Sound/mute and reduced
 * motion are UI concerns and cannot alter this fixed alert lifetime.
 */
export function alertView(alert, now) {
  if (!alert || typeof alert !== 'object' || Array.isArray(alert)
    || !validKind(alert.kind) || !validTime(alert.startedAt) || !validTime(alert.until)
    || alert.until !== alert.startedAt + ALERT_DURATION[alert.kind]
    || !validTime(now) || now < alert.startedAt || now >= alert.until) return inactive();
  const elapsed = now - alert.startedAt;
  return {
    active: true,
    ledOn: elapsed % 1000 < 500,
    pulseIndex: Math.floor(elapsed / 1000),
    remainingMs: alert.until - now,
  };
}

/** Replace the caller's alert state with this value to cancel immediately. */
export function cancelAlert() {
  return null;
}
