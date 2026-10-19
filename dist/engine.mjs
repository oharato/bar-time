/** Pure, wall-clock-based timer engine. All durations in config are whole seconds. */
export const MAX_DOWN = 5990;
export const MAX_UP = 5999;

const DEFAULTS = { mode: 'down', duration: 1500, work: 1500, rest: 300, cycles: 4 };
const MODES = new Set(['down', 'up', 'repeat']);
const STATUSES = new Set(['idle', 'running', 'paused', 'done']);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const time = value => finite(value) ? value : 0;
const integer = (value, fallback, low, high) => clamp(Math.floor(finite(value) ? value : fallback), low, high);

/** Invalid/missing fields use defaults; finite values are floored and clamped. */
export function normalizeConfig(input = {}) {
  const config = record(input) ? input : {};
  return {
    mode: MODES.has(config.mode) ? config.mode : DEFAULTS.mode,
    duration: integer(config.duration, DEFAULTS.duration, 1, MAX_DOWN),
    work: integer(config.work, DEFAULTS.work, 1, MAX_DOWN),
    rest: integer(config.rest, DEFAULTS.rest, 0, MAX_DOWN),
    cycles: integer(config.cycles, DEFAULTS.cycles, 1, 99),
  };
}

function lengthMs(config) {
  if (config.mode === 'up') return MAX_UP * 1000;
  if (config.mode === 'repeat') return (config.work * config.cycles + config.rest * (config.cycles - 1)) * 1000;
  return config.duration * 1000;
}

/**
 * Persist this entire JSON-safe object, not snapshot(). No function mutates input.
 * elapsedMs is total elapsed at startedAt; paused/idle/done have a null startedAt.
 * Running elapsed = elapsedMs + max(0, now - startedAt), capped at session length.
 * Pass the same wall-clock time source (normally Date.now()) across calls/reloads.
 * Clock changes backwards never subtract already accumulated elapsed time.
 */
export function createState(config = {}, _now = Date.now()) {
  return { version: 1, config: normalizeConfig(config), status: 'idle', elapsedMs: 0, startedAt: null };
}

/** Recover a parsed persisted state. Malformed anchors stop safely, rather than inventing elapsed time. */
export function hydrate(raw, now = Date.now()) {
  const at = time(now);
  if (!record(raw) || raw.version !== 1) return createState(record(raw) ? raw.config : {});
  const config = normalizeConfig(raw.config);
  const total = lengthMs(config);
  let status = STATUSES.has(raw.status) ? raw.status : 'idle';
  let elapsedMs = finite(raw.elapsedMs) ? clamp(raw.elapsedMs, 0, total) : 0;
  if (status === 'idle') elapsedMs = 0;
  if (status === 'done') elapsedMs = total;
  if (status === 'running') {
    if (finite(raw.startedAt)) elapsedMs = Math.min(total, elapsedMs + Math.max(0, at - raw.startedAt));
    else status = elapsedMs > 0 ? 'paused' : 'idle';
  }
  if (elapsedMs >= total) status = 'done';
  return { version: 1, config, status, elapsedMs, startedAt: status === 'running' ? at : null };
}

/** Start/resume; starting an expired/done session begins a fresh session. */
export function start(state, now = Date.now()) {
  const current = hydrate(state, now);
  if (current.status === 'running') return current;
  return { ...current, status: 'running', elapsedMs: current.status === 'done' ? 0 : current.elapsedMs, startedAt: time(now) };
}

/** Freeze at now. Pausing an already expired timer leaves it done. */
export function pause(state, now = Date.now()) {
  const current = hydrate(state, now);
  return current.status === 'running' ? { ...current, status: 'paused', startedAt: null } : current;
}

/** Return to idle with the same normalized configuration. */
export function reset(state, now = Date.now()) {
  return createState(record(state) ? state.config : {}, now);
}

/**
 * Read-only view; elapsedMs/remainingMs describe the CURRENT phase, while
 * totalElapsedMs describes the entire session. cycle is 1-based (1 for timers).
 * Repeat includes a rest only between work periods, with an O(1) phase lookup.
 * displaySeconds rounds countdowns up and count-up down. progress is the filled
 * bar fraction: remaining/current-phase duration, or elapsed/MAX_UP for count-up.
 * phaseKey stays constant throughout a phase; also check completed for expiry.
 */
export function snapshot(state, now = Date.now()) {
  const current = hydrate(state, now);
  const { config, status } = current;
  const totalElapsedMs = current.elapsedMs;
  const completed = status === 'done';
  let phase = 'timer';
  let cycle = 1;
  let totalCycles = 1;
  let phaseDurationMs = lengthMs(config);
  let elapsedMs = totalElapsedMs;

  if (config.mode === 'repeat') {
    totalCycles = config.cycles;
    const workMs = config.work * 1000;
    const restMs = config.rest * 1000;
    const blockMs = workMs + restMs;
    cycle = completed ? totalCycles : Math.min(totalCycles, Math.floor(totalElapsedMs / blockMs) + 1);
    const offsetMs = totalElapsedMs - (cycle - 1) * blockMs;
    phase = !completed && offsetMs >= workMs && restMs > 0 ? 'rest' : 'work';
    phaseDurationMs = phase === 'rest' ? restMs : workMs;
    elapsedMs = completed ? workMs : phase === 'rest' ? offsetMs - workMs : offsetMs;
  }

  elapsedMs = clamp(elapsedMs, 0, phaseDurationMs);
  const remainingMs = Math.max(0, phaseDurationMs - elapsedMs);
  const countingUp = config.mode === 'up';
  return {
    mode: config.mode,
    status,
    phase,
    cycle,
    totalCycles,
    remainingMs,
    elapsedMs,
    displaySeconds: countingUp ? Math.floor(elapsedMs / 1000) : Math.ceil(remainingMs / 1000),
    progress: clamp(countingUp ? elapsedMs / phaseDurationMs : remainingMs / phaseDurationMs, 0, 1),
    completed,
    phaseKey: `${config.mode}:${phase}:${cycle}`,
    totalElapsedMs,
  };
}

/** Whole LCD segments only: no partially filled bars. */
export function barCount(view) {
  if (!view || typeof view.progress !== 'number' || !Number.isFinite(view.progress)) return 0;
  const fraction = Math.min(1, Math.max(0, view.progress));
  return view.mode === 'up' ? Math.floor(fraction * 10 + 1e-10) : Math.max(0,Math.ceil(fraction * 10 - 1e-10));
}
