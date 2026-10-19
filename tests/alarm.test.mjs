import test from 'node:test';
import assert from 'node:assert/strict';
import { ALERT_DURATION, createAlert, alertView, cancelAlert } from '../dist/alarm.mjs';

const inactive = { active: false, ledOn: false, pulseIndex: -1, remainingMs: 0 };

test('completion lasts exactly ten seconds and produces ten one-second pulse indices', () => {
  assert.deepEqual(ALERT_DURATION, { transition: 3000, complete: 10000 });
  const alert = createAlert('complete', 1234);
  assert.deepEqual(alert, { kind: 'complete', startedAt: 1234, until: 11234 });
  for (let pulse = 0; pulse < 10; pulse++) {
    assert.deepEqual(alertView(alert, 1234 + pulse * 1000), {
      active: true, ledOn: true, pulseIndex: pulse, remainingMs: 10000 - pulse * 1000,
    });
  }
  assert.deepEqual(alertView(alert, 11234), inactive);
});

test('repeat transitions last exactly three seconds and produce only three pulse indices', () => {
  const alert = createAlert('transition', 5000);
  assert.deepEqual(alert, { kind: 'transition', startedAt: 5000, until: 8000 });
  for (let pulse = 0; pulse < 3; pulse++) {
    const view = alertView(alert, 5000 + pulse * 1000);
    assert.equal(view.active, true);
    assert.equal(view.pulseIndex, pulse);
    assert.equal(view.remainingMs, 3000 - pulse * 1000);
  }
  assert.deepEqual(alertView(alert, 8000), inactive);
});

test('LED and pulse boundaries use the event anchor, including exact expiry', () => {
  for (const kind of Object.keys(ALERT_DURATION)) {
    const start = 123;
    const alert = createAlert(kind, start);
    assert.deepEqual(alertView(alert, start - 1), inactive);
    for (let pulse = 0; pulse < ALERT_DURATION[kind] / 1000; pulse++) {
      for (const [offset, ledOn] of [[0, true], [499, true], [500, false], [999, false]]) {
        const view = alertView(alert, start + pulse * 1000 + offset);
        assert.equal(view.active, true);
        assert.equal(view.ledOn, ledOn, `${kind} pulse ${pulse} at +${offset} ms`);
        assert.equal(view.pulseIndex, pulse);
      }
    }
    assert.equal(alertView(alert, alert.until - 1).remainingMs, 1);
    assert.deepEqual(alertView(alert, alert.until), inactive);
    assert.deepEqual(alertView(alert, alert.until + 1), inactive);
  }
});

test('cancellation immediately clears all output and is safe when repeated', () => {
  let alert = createAlert('complete', 1000);
  assert.equal(alertView(alert, 1000).active, true);
  alert = cancelAlert();
  assert.equal(alert, null);
  for (const now of [1000, 1500, 10000, 1e12]) assert.deepEqual(alertView(alert, now), inactive);
  assert.equal(cancelAlert(), null);
});

test('late observations jump to the current pulse without extending or replaying the alert', () => {
  const alert = Object.freeze(createAlert('complete', 1000));
  assert.equal(alertView(alert, 1000).pulseIndex, 0);
  assert.deepEqual(alertView(alert, 8500), {
    active: true, ledOn: false, pulseIndex: 7, remainingMs: 2500,
  });
  assert.equal(alertView(alert, 9000).pulseIndex, 8);
  assert.deepEqual(alertView(alert, 1e12), inactive);
  assert.deepEqual(alert, { kind: 'complete', startedAt: 1000, until: 11000 });
  // An event discovered after its deadline is already over; creation does not restart it.
  assert.deepEqual(alertView(createAlert('transition', 2000), 7000), inactive);
});

test('views are deterministic, JSON-safe and never mutate or share mutable state', () => {
  const alert = Object.freeze(createAlert('transition', 0));
  const restored = JSON.parse(JSON.stringify(alert));
  assert.deepEqual(alertView(restored, 1250), alertView(alert, 1250));
  assert.deepEqual(alert, { kind: 'transition', startedAt: 0, until: 3000 });
  assert.notEqual(createAlert('transition', 0), createAlert('transition', 0));
  const result = alertView(alert, 1000);
  result.ledOn = false;
  assert.equal(alertView(alert, 1000).ledOn, true);
  const stopped = alertView(null, 1000);
  stopped.active = true;
  assert.deepEqual(alertView(null, 1000), inactive);
  assert.equal(Object.isFrozen(ALERT_DURATION), true);
});

test('invalid kinds and timestamps fail closed without coercion', () => {
  for (const kind of [undefined, null, '', 'done', 'constructor', '__proto__', {}, [], 1, Symbol('complete')]) {
    assert.equal(createAlert(kind, 1000), null);
  }
  for (const now of [undefined, null, '1000', true, {}, [], NaN, Infinity, -Infinity, -1, Number.MAX_VALUE]) {
    assert.equal(createAlert('complete', now), null);
    assert.deepEqual(alertView(createAlert('complete', 0), now), inactive);
  }
  assert.equal(createAlert('complete', Number.MAX_SAFE_INTEGER), null);
  // Fractional timestamps are useful with a monotonic millisecond clock.
  assert.deepEqual(alertView(createAlert('transition', 10.25), 510.25), {
    active: true, ledOn: false, pulseIndex: 0, remainingMs: 2500,
  });
});

test('malformed persisted alert states cannot create or extend an alarm', () => {
  const valid = createAlert('complete', 1000);
  const malformed = [
    undefined, null, false, 1, 'complete', [], {},
    { ...valid, kind: 'bad' }, { ...valid, kind: 'toString' },
    { ...valid, startedAt: null }, { ...valid, startedAt: '1000' },
    { ...valid, startedAt: NaN }, { ...valid, startedAt: -1 },
    { ...valid, until: null }, { ...valid, until: '11000' },
    { ...valid, until: Infinity }, { ...valid, until: -1 },
    { ...valid, until: 1000 }, { ...valid, until: 11001 },
    { ...valid, until: 10999 }, { ...valid, kind: 'transition' },
  ];
  for (const state of malformed) assert.deepEqual(alertView(state, 1500), inactive);
});
