import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIGITAL_LAYOUT, DIGIT_SEGMENTS, SEGMENT_POINTS,
  normalizeDisplaySeconds, renderDigitalDisplay,
} from '../dist/digits.mjs';

const groups = svg => [...svg.matchAll(/<g\b([^>]*)>(.*?)<\/g>/g)].map(([, attributes, body]) => ({ attributes, body }));
const digits = svg => [...svg.matchAll(/data-digit="(\d)"/g)].map(match => match[1]).join('');
const litSegments = body => [...body.matchAll(/<polygon\b([^>]*)\/>/g)]
  .filter(([, attributes]) => !attributes.includes('class="segment-off"'))
  .map(([, attributes]) => attributes.match(/data-segment="([a-g])"/)[1]).join('');
const translate = (points, dx, dy) => points.map(([x, y]) => [x + dx, y + dy]);

test('every digit has the correct seven-segment pattern', () => {
  const expected = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
  assert.deepEqual(DIGIT_SEGMENTS, expected);
  for (let digit = 0; digit <= 9; digit++) {
    const glyph = groups(renderDigitalDisplay(digit))[3];
    assert.equal(litSegments(glyph.body), expected[digit], `digit ${digit}`);
    assert.equal((glyph.body.match(/<polygon\b/g) || []).length, 7);
    assert.equal((glyph.body.match(/class="segment-off"/g) || []).length, 7 - expected[digit].length);
  }
});

test('four glyphs and 28 polygons share one fixed SVG viewport', () => {
  const svg = renderDigitalDisplay(754);
  assert.equal((svg.match(/<svg\b/g) || []).length, 1);
  assert.match(svg, /class="digital-svg"/);
  assert.match(svg, /viewBox="0 0 220 76"/);
  assert.match(svg, /preserveAspectRatio="xMidYMid meet"/);
  assert.match(svg, /shape-rendering="geometricPrecision"/);
  assert.equal(groups(svg).length, 4);
  assert.equal((svg.match(/<polygon\b/g) || []).length, 28);
  assert.deepEqual(groups(svg).map(group => group.attributes.match(/transform="([^"]+)"/)[1]), [
    'translate(0 2)', 'translate(46 2)', 'translate(112 2)', 'translate(158 2)',
  ]);
  assert.match(svg, /<text class="digit-unit" x="91" y="73">M<\/text>/);
  assert.match(svg, /<text class="digit-unit" x="203" y="73">S<\/text>/);
  assert.doesNotMatch(svg, /<(?:filter|line|path)\b|\bstroke(?:-width)?=|skew|style=/);
});

test('seconds are floored and clamped into 00:00 through 99:59', () => {
  for (const [seconds, expected] of [
    [-1, '0000'], [0, '0000'], [0.9, '0000'], [1.9, '0001'],
    [59, '0059'], [59.99, '0059'], [60, '0100'], [754, '1234'],
    [5998.99, '9958'], [5999, '9959'], [6000, '9959'], [Number.MAX_VALUE, '9959'],
  ]) assert.equal(digits(renderDigitalDisplay(seconds)), expected, String(seconds));
  for (const invalid of [undefined, null, NaN, Infinity, -Infinity, '60', {}, [], true]) {
    assert.equal(normalizeDisplaySeconds(invalid), 0);
    assert.equal(digits(renderDigitalDisplay(invalid)), '0000');
  }
});

test('bevel geometry uses the exact integer grid and symmetrical translations', () => {
  assert.deepEqual(SEGMENT_POINTS.a, [[8, 0], [32, 0], [35, 3], [32, 6], [8, 6], [5, 3]]);
  assert.deepEqual(SEGMENT_POINTS.b, [[37, 5], [40, 8], [40, 31], [37, 34], [34, 31], [34, 8]]);
  assert.deepEqual(SEGMENT_POINTS.e, [[3, 38], [6, 41], [6, 64], [3, 67], [0, 64], [0, 41]]);
  assert.deepEqual(SEGMENT_POINTS.g, translate(SEGMENT_POINTS.a, 0, 33));
  assert.deepEqual(SEGMENT_POINTS.d, translate(SEGMENT_POINTS.a, 0, 66));
  assert.deepEqual(SEGMENT_POINTS.c, translate(SEGMENT_POINTS.b, 0, 33));
  assert.deepEqual(SEGMENT_POINTS.f, translate(SEGMENT_POINTS.e, 0, -33));
  assert.deepEqual(SEGMENT_POINTS.f, translate(SEGMENT_POINTS.b, -34, 0));
  assert.deepEqual(SEGMENT_POINTS.e, translate(SEGMENT_POINTS.c, -34, 0));
  for (const points of Object.values(SEGMENT_POINTS)) {
    assert.equal(points.length, 6);
    assert.ok(Object.isFrozen(points));
    for (const [x, y] of points) {
      assert.ok(Number.isInteger(x) && Number.isInteger(y));
      assert.ok(x >= 0 && x <= DIGITAL_LAYOUT.glyphWidth);
      assert.ok(y >= 0 && y <= DIGITAL_LAYOUT.glyphHeight);
    }
  }
});

test('layout and polygon coordinates remain identical across every valid time', () => {
  const geometryOnly = svg => svg.replace(/data-digit="\d"/g, 'data-digit="0"').replace(/ class="segment-off"/g, '');
  const expected = geometryOnly(renderDigitalDisplay(0));
  for (let seconds = 0; seconds <= 5999; seconds++) {
    const svg = renderDigitalDisplay(seconds);
    assert.equal(geometryOnly(svg), expected, `${seconds} seconds`);
    assert.equal(digits(svg), `${String(Math.floor(seconds / 60)).padStart(2, '0')}${String(seconds % 60).padStart(2, '0')}`);
  }
});
