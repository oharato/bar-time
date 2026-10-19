// One integer-grid shape set and one SVG viewport keep every time aligned.
const freezePoints = points => Object.freeze(points.map(point => Object.freeze(point)));
const translate = (points, dx, dy) => freezePoints(points.map(([x, y]) => [x + dx, y + dy]));
const horizontal = freezePoints([[8, 0], [32, 0], [35, 3], [32, 6], [8, 6], [5, 3]]);
const upperRight = freezePoints([[37, 5], [40, 8], [40, 31], [37, 34], [34, 31], [34, 8]]);
const lowerLeft = freezePoints([[3, 38], [6, 41], [6, 64], [3, 67], [0, 64], [0, 41]]);

export const SEGMENT_POINTS = Object.freeze({
  a: horizontal,
  b: upperRight,
  c: translate(upperRight, 0, 33),
  d: translate(horizontal, 0, 66),
  e: lowerLeft,
  f: translate(lowerLeft, 0, -33),
  g: translate(horizontal, 0, 33),
});

export const DIGIT_SEGMENTS = Object.freeze([
  'abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg',
  'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg',
]);

export const DIGITAL_LAYOUT = Object.freeze({
  viewBox: '0 0 220 76',
  glyphWidth: 40,
  glyphHeight: 72,
  glyphX: Object.freeze([0, 46, 112, 158]),
  glyphY: 2,
  unitX: Object.freeze([91, 203]),
  unitY: 73,
});

export function normalizeDisplaySeconds(seconds) {
  return Number.isFinite(seconds) ? Math.max(0, Math.min(5999, Math.floor(seconds))) : 0;
}

export function renderDigitalDisplay(seconds) {
  const total = normalizeDisplaySeconds(seconds);
  const digits = String(Math.floor(total / 60)).padStart(2, '0')
    + String(total % 60).padStart(2, '0');
  const glyphs = [...digits].map((digit, index) => {
    const lit = DIGIT_SEGMENTS[Number(digit)];
    const polygons = Object.entries(SEGMENT_POINTS).map(([segment, points]) =>
      `<polygon data-segment="${segment}" points="${points.map(point => point.join(',')).join(' ')}"${lit.includes(segment) ? '' : ' class="segment-off"'}/>`
    ).join('');
    return `<g class="digital-glyph" data-digit="${digit}" transform="translate(${DIGITAL_LAYOUT.glyphX[index]} ${DIGITAL_LAYOUT.glyphY})">${polygons}</g>`;
  }).join('');
  const units = ['M', 'S'].map((unit, index) =>
    `<text class="digit-unit" x="${DIGITAL_LAYOUT.unitX[index]}" y="${DIGITAL_LAYOUT.unitY}">${unit}</text>`
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="digital-svg" viewBox="${DIGITAL_LAYOUT.viewBox}" preserveAspectRatio="xMidYMid meet" shape-rendering="geometricPrecision" aria-hidden="true">${glyphs}${units}</svg>`;
}
