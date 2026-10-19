import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DOWN, MAX_UP, normalizeConfig, createState, start, pause, reset, snapshot, hydrate } from '../dist/engine.mjs';

const running = (config, at = 1000) => start(createState(config, at), at);

test('configuration defaults, integer seconds, and safe limits', () => {
  assert.deepEqual(normalizeConfig(), { mode: 'down', duration: 1500, work: 1500, rest: 300, cycles: 4 });
  assert.deepEqual(normalizeConfig({ mode: 'bad', duration: 0, work: -1, rest: -10, cycles: 0 }), { mode: 'down', duration: 1, work: 1, rest: 0, cycles: 1 });
  const max = normalizeConfig({ duration: 1e9, work: 1e9, rest: 1e9, cycles: 1000 });
  assert.equal(max.duration, MAX_DOWN);
  assert.equal(max.work, MAX_DOWN);
  assert.equal(max.rest, MAX_DOWN);
  assert.equal(max.cycles, 99);
  assert.equal(normalizeConfig({ duration: 5.9 }).duration, 5);
  for (const value of [null, [], 'bad', 42]) assert.deepEqual(normalizeConfig(value), normalizeConfig());
});

test('countdown starts full and expires exactly at its boundary', () => {
  const idle = createState({ duration: 5 });
  assert.equal(snapshot(idle, 9000).status, 'idle');
  assert.equal(snapshot(idle, 9000).progress, 1);
  const state = start(idle, 1000);
  assert.equal(snapshot(state, 1001).displaySeconds, 5);
  assert.equal(snapshot(state, 2000).displaySeconds, 4);
  assert.equal(snapshot(state, 5999).displaySeconds, 1);
  const done = snapshot(state, 6000);
  assert.equal(done.status, 'done');
  assert.equal(done.remainingMs, 0);
  assert.equal(done.elapsedMs, 5000);
  assert.equal(done.displaySeconds, 0);
  assert.equal(done.progress, 0);
  assert.equal(done.completed, true);
  assert.deepEqual(snapshot(state, 1e12), done);
});

test('countdown permits its precise 99:50 maximum', () => {
  const state = running({ duration: MAX_DOWN });
  assert.equal(snapshot(state, 1000).displaySeconds, 5990);
  assert.equal(snapshot(state, 1000 + MAX_DOWN * 1000).status, 'done');
});

test('pause and resume exclude paused wall time without resetting phase', () => {
  const state = running({ duration: 10 });
  const stopped = pause(state, 2500);
  assert.equal(stopped.elapsedMs, 1500);
  assert.equal(snapshot(stopped, 100000).remainingMs, 8500);
  const resumed = start(stopped, 100000);
  assert.equal(snapshot(resumed, 100500).remainingMs, 8000);
  assert.equal(snapshot(resumed, 108500).status, 'done');
  assert.equal(pause(state, 12000).status, 'done');
});

test('operations never mutate the supplied state or configuration', () => {
  const config = Object.freeze({ mode: 'repeat', work: 2, rest: 1, cycles: 3 });
  const state = running(config);
  Object.freeze(state.config);
  Object.freeze(state);
  const before = JSON.stringify(state);
  for (const fn of [start, pause, reset, snapshot, hydrate]) fn(state, 1500);
  assert.equal(JSON.stringify(state), before);
  assert.equal(reset(state).status, 'idle');
  assert.deepEqual(reset(state).config, state.config);
  assert.notEqual(reset(state).config, state.config);
});

test('starting a complete or implicitly expired timer starts over', () => {
  const state = running({ duration: 1 });
  const done = hydrate(state, 2000);
  for (const input of [state, done]) {
    const restarted = start(input, 8000);
    assert.equal(snapshot(restarted, 8000).remainingMs, 1000);
    assert.equal(restarted.status, 'running');
  }
  assert.equal(pause(createState(), 1000).status, 'idle');
});

test('frequent snapshots do not accumulate rendering drift', () => {
  const state = running({ duration: 10 });
  for (let now = 1000; now < 9999; now += 7) snapshot(state, now);
  assert.equal(snapshot(state, 9999).remainingMs, 1001);
  let recovered = state;
  for (let now = 1001; now <= 9999; now += 1) recovered = hydrate(recovered, now);
  assert.deepEqual(snapshot(recovered, 10000), snapshot(state, 10000));
});

test('reload and background wall time recover running and completed timers', () => {
  const serialized = JSON.stringify(running({ duration: 10 }));
  const recovered = hydrate(JSON.parse(serialized), 6000);
  assert.equal(snapshot(recovered, 6000).remainingMs, 5000);
  assert.equal(snapshot(recovered, 8000).remainingMs, 3000);
  assert.equal(hydrate(JSON.parse(serialized), 20000).status, 'done');
  const paused = pause(recovered, 7000);
  assert.equal(hydrate(JSON.parse(JSON.stringify(paused)), 1e12).elapsedMs, 6000);
});

test('a backwards clock does not create negative or decreasing accrued time', () => {
  const state = running({ duration: 10 }, 10000);
  assert.equal(snapshot(state, 9000).totalElapsedMs, 0);
  const recovered = hydrate(state, 11000);
  assert.equal(snapshot(recovered, 10500).totalElapsedMs, 1000);
});

test('count-up floors seconds and caps at 99:59', () => {
  const state = running({ mode: 'up' });
  assert.equal(snapshot(state, 1000).displaySeconds, 0);
  assert.equal(snapshot(state, 1999).displaySeconds, 0);
  assert.equal(snapshot(state, 2000).displaySeconds, 1);
  assert.equal(snapshot(state, 1000 + MAX_UP * 1000 - 1).displaySeconds, 5998);
  const end = snapshot(state, 1000 + MAX_UP * 1000);
  assert.equal(end.displaySeconds, 5999);
  assert.equal(end.progress, 1);
  assert.equal(end.status, 'done');
  assert.equal(end.remainingMs, 0);
});

test('repeat enters rest and next work exactly at phase boundaries', () => {
  const state = running({ mode: 'repeat', work: 2, rest: 1, cycles: 3 }, 0);
  const expected = [
    [0, 'work', 1, 2000, 'running'],
    [1999, 'work', 1, 1, 'running'],
    [2000, 'rest', 1, 1000, 'running'],
    [2999, 'rest', 1, 1, 'running'],
    [3000, 'work', 2, 2000, 'running'],
    [5000, 'rest', 2, 1000, 'running'],
    [6000, 'work', 3, 2000, 'running'],
    [8000, 'work', 3, 0, 'done'],
  ];
  for (const [now, phase, cycle, remainingMs, status] of expected) {
    const view = snapshot(state, now);
    assert.equal(view.phase, phase, `phase at ${now}`);
    assert.equal(view.cycle, cycle, `cycle at ${now}`);
    assert.equal(view.remainingMs, remainingMs, `remaining at ${now}`);
    assert.equal(view.status, status, `status at ${now}`);
    assert.equal(view.phaseKey, `repeat:${phase}:${cycle}`);
    assert.equal(view.totalCycles, 3);
  }
  assert.equal(snapshot(state, 4500).elapsedMs, 1500);
  assert.equal(snapshot(state, 4500).totalElapsedMs, 4500);
  assert.equal(snapshot(state, 4500).progress, 0.25);
});

test('repeat pause within rest resumes the same rest', () => {
  const state = pause(running({ mode: 'repeat', work: 2, rest: 1, cycles: 3 }, 0), 2500);
  const resumed = start(state, 10000);
  assert.equal(snapshot(resumed, 10000).phase, 'rest');
  assert.equal(snapshot(resumed, 10499).remainingMs, 1);
  assert.equal(snapshot(resumed, 10500).phaseKey, 'repeat:work:2');
});

test('zero-rest repeats never create an empty rest phase', () => {
  const state = running({ mode: 'repeat', work: 1, rest: 0, cycles: 3 }, 0);
  assert.equal(snapshot(state, 1000).phaseKey, 'repeat:work:2');
  assert.equal(snapshot(state, 2000).phaseKey, 'repeat:work:3');
  assert.equal(snapshot(state, 2999).status, 'running');
  assert.equal(snapshot(state, 3000).status, 'done');
  assert.equal(snapshot(state, 3000).phase, 'work');
});

test('one-cycle repeat ends after work without any rest', () => {
  const state = running({ mode: 'repeat', work: 2, rest: 100, cycles: 1 }, 0);
  const done = snapshot(state, 2000);
  assert.equal(done.phase, 'work');
  assert.equal(done.status, 'done');
  assert.equal(done.cycle, 1);
  assert.equal(done.totalElapsedMs, 2000);
});

test('99 cycles and large sleeps jump directly to the correct phase or completion', () => {
  const state = running({ mode: 'repeat', work: 10, rest: 5, cycles: 99 }, 0);
  assert.equal(snapshot(state, 15 * 73000 + 12000).phaseKey, 'repeat:rest:74');
  assert.equal(snapshot(state, 15 * 98000).phaseKey, 'repeat:work:99');
  const done = snapshot(state, 1e15);
  assert.equal(done.status, 'done');
  assert.equal(done.cycle, 99);
  assert.equal(done.totalElapsedMs, (99 * 10 + 98 * 5) * 1000);
  assert.equal(done.progress, 0);
});

test('corrupt persisted data is safely normalized', () => {
  for (const raw of [null, false, [], 'broken', 3, {}, { version: 2 }]) {
    assert.equal(hydrate(raw, 1234).status, 'idle');
    assert.equal(snapshot(hydrate(raw, 1234), 1234).displaySeconds, 1500);
  }
  const base = createState({ duration: 5 });
  assert.equal(hydrate({ ...base, status: 'unknown', elapsedMs: 12 }).elapsedMs, 0);
  assert.equal(hydrate({ ...base, status: 'running', startedAt: 'bad' }, 1000).status, 'idle');
  assert.equal(hydrate({ ...base, status: 'running', startedAt: null, elapsedMs: 1000 }, 1000).status, 'paused');
  assert.equal(hydrate({ ...base, status: 'paused', elapsedMs: -100 }, 1000).elapsedMs, 0);
  assert.equal(hydrate({ ...base, status: 'paused', elapsedMs: Infinity }, 1000).elapsedMs, 0);
  assert.equal(hydrate({ ...base, status: 'paused', elapsedMs: 100000 }, 1000).status, 'done');
  const zeroed = hydrate({ ...base, config: { duration: 0, mode: 'repeat', work: 0, rest: 0, cycles: 0 } }, 0);
  assert.equal(snapshot(start(zeroed, 0), 1000).completed, true);
});

test('LCD bars are discrete and preserve countdown and countup directions', async () => {
  const {barCount}=await import('../dist/engine.mjs');
  assert.equal(barCount({mode:'down',progress:1}),10);assert.equal(barCount({mode:'down',progress:.91}),10);assert.equal(barCount({mode:'down',progress:.9}),9);assert.equal(barCount({mode:'down',progress:.01}),1);assert.equal(barCount({mode:'down',progress:0}),0);
  assert.equal(barCount({mode:'up',progress:0}),0);assert.equal(barCount({mode:'up',progress:.099}),0);assert.equal(barCount({mode:'up',progress:.1}),1);assert.equal(barCount({mode:'up',progress:1}),10);assert.equal(barCount({mode:'down',progress:NaN}),0);
});
