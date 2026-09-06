import test from 'node:test';
import assert from 'node:assert/strict';
import { placeLabels, arrowBetween, rotationArrow, stretchIndicator } from '../app/annotate/place.ts';
import { benchmark } from './place-bench.mjs';

const viewport = { w: 800, h: 600 };
const anchor = { id: 'a', x: 400, y: 300, r: 20 };
const label = (id, extra = {}) => ({ id, target: 'a', w: 70, h: 24, ...extra });
const near = (a, b, eps = 1e-7) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
function inside(box, vp) {
  const pad = vp.pad ?? 8;
  assert.ok(box.x >= pad && box.y >= pad, JSON.stringify(box));
  if (!box.clipped) assert.ok(box.x + box.w <= vp.w - pad + 1e-8 && box.y + box.h <= vp.h - pad + 1e-8, JSON.stringify(box));
}
function disjoint(boxes) {
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++)
    assert.equal(overlap(boxes[i], boxes[j]), 0, `${boxes[i].id} overlaps ${boxes[j].id}`);
}
function checkLeader(box, a) {
  assert.ok(box.leader);
  const { x1, y1, x2, y2 } = box.leader;
  near(Math.hypot(x1 - a.x, y1 - a.y), a.r, 0.5);
  assert.ok(x2 >= box.x - 1e-8 && x2 <= box.x + box.w + 1e-8);
  assert.ok(y2 >= box.y - 1e-8 && y2 <= box.y + box.h + 1e-8);
  assert.ok(Math.min(Math.abs(x2 - box.x), Math.abs(x2 - box.x - box.w),
    Math.abs(y2 - box.y), Math.abs(y2 - box.y - box.h)) < 1e-7);
}

test('empty input', () => assert.deepEqual(placeLabels(viewport, [], []), []));
test('one label sits right at default gap with no leader', () => {
  const [p] = placeLabels(viewport, [anchor], [label('one')]);
  assert.equal(p.side, 'right'); near(p.x, 430); near(p.y, 288);
  assert.equal(p.leader, null); assert.equal(p.clipped, false); near(p.score, 0.5);
});
test('two labels on the same anchor do not overlap', () => {
  disjoint(placeLabels(viewport, [anchor], [label('one'), label('two')]));
});
test('a free candidate beats even a tiny overlap with a cheaper weighted score', () => {
  const boxes = placeLabels(viewport, [anchor], [label('a', { w: 0.01, h: 0.01 }), label('b', { w: 0.01, h: 0.01 })]);
  disjoint(boxes); near(boxes[0].x, 430); near(boxes[1].x, 440);
});
test('disc penalties use actual circular area including partial intersections', () => {
  const cases = [
    { a: { id: 'a', x: 100, y: 100, r: 0 }, obstacle: { id: 'b', x: 110, y: 100, r: 10 }, w: 20, h: 20, area: 50 * Math.PI },
    { a: { id: 'a', x: 100, y: 105, r: 0 }, obstacle: { id: 'b', x: 110, y: 100, r: 10 }, w: 5, h: 10, area: 47.83057387452591 },
    { a: { id: 'a', x: 100, y: 111, r: 0 }, obstacle: { id: 'b', x: 100, y: 100, r: 10 }, w: 2, h: 2, area: 0 },
  ];
  for (const { a, obstacle, w, h, area } of cases) {
    const [p] = placeLabels(viewport, [a, obstacle], [label('one', { w, h })], { maxCandidates: 1 });
    near(p.score, 2 * area + 0.5);
  }
});
test('near the right edge the label moves left', () => {
  const [p] = placeLabels(viewport, [{ ...anchor, x: 775 }], [label('one')]);
  assert.equal(p.side, 'left'); inside(p, viewport);
});
test('all boxes remain within a small viewport', () => {
  const vp = { w: 300, h: 200 };
  const anchors = [{ id: 'a', x: 15, y: 15, r: 12 }, { id: 'b', x: 285, y: 185, r: 12 }];
  const boxes = placeLabels(vp, anchors, Array.from({ length: 8 }, (_, i) => label(`${i}`, { target: i % 2 ? 'a' : 'b', w: 62, h: 22 })));
  boxes.forEach(b => inside(b, vp));
});
test('oversized labels are flagged and clamped to padded top-left', () => {
  const [p] = placeLabels({ w: 100, h: 80 }, [{ ...anchor, x: 50, y: 40 }], [label('big', { w: 150, h: 90 })]);
  assert.equal(p.clipped, true); assert.equal(p.x, 8); assert.equal(p.y, 8);
  assert.equal(p.w, 150); assert.equal(p.h, 90);
});
test('ten labels on three crowded anchors stay disjoint and inside', () => {
  const vp = { w: 300, h: 200 };
  const anchors = [{ id: 'a', x: 125, y: 90, r: 12 }, { id: 'b', x: 175, y: 100, r: 12 }, { id: 'c', x: 150, y: 135, r: 12 }];
  const labels = Array.from({ length: 10 }, (_, i) => label(`label-${i}`, { target: anchors[i % 3].id, w: 36, h: 16 }));
  const boxes = placeLabels(vp, anchors, labels);
  disjoint(boxes); boxes.forEach(b => inside(b, vp));
});
test('third gap ring produces a leader with correct endpoints', () => {
  const positions = [[432, 300], [368, 300], [400, 268], [400, 332],
    [423.2132034356, 276.7867965644], [376.7867965644, 276.7867965644],
    [423.2132034356, 323.2132034356], [376.7867965644, 323.2132034356]];
  const blockers = positions.map(([x, y], i) => ({ id: `block-${i}`, x, y, r: 12 }));
  const [p] = placeLabels(viewport, [anchor, ...blockers], [label('far', { w: 4, h: 4 })]);
  near(p.x, 450); checkLeader(p, anchor);
  near(Math.hypot(p.leader.x2 - anchor.x, p.leader.y2 - anchor.y) - anchor.r, 30);
});
test('repeated calls are deeply deterministic', () => {
  const labels = Array.from({ length: 12 }, (_, i) => label(`${i}`, { priority: i % 3 }));
  assert.deepEqual(placeLabels(viewport, [anchor], labels), placeLabels(viewport, [anchor], labels));
});
test('results preserve caller order', () => {
  const labels = [label('z'), label('a', { priority: 9 }), label('m')];
  assert.deepEqual(placeLabels(viewport, [anchor], labels).map(p => p.id), ['z', 'a', 'm']);
});
test('priority wins the best slot', () => {
  const [low, high] = placeLabels(viewport, [anchor], [label('a-low'), label('z-high', { priority: 4 })]);
  assert.equal(high.side, 'right'); assert.notEqual(low.side, 'right');
});
test('equal priorities use anchor y then lexical id', () => {
  const labels = [label('z'), label('a')];
  assert.equal(placeLabels(viewport, [anchor], labels)[1].side, 'right');
  const anchors = [{ ...anchor, id: 'upper', y: 290 }, { ...anchor, id: 'lower', y: 300 }];
  const boxes = placeLabels(viewport, anchors, [label('a', { target: 'lower' }), label('z', { target: 'upper' })]);
  near(boxes[1].x, 430); near(boxes[1].y, 278);
});
test('other anatomy discs repel labels', () => {
  const obstacle = { id: 'obstacle', x: 465, y: 300, r: 32 };
  const [p] = placeLabels(viewport, [anchor, obstacle], [label('one')]);
  assert.equal(p.side, 'left');
  const x = Math.max(p.x, Math.min(obstacle.x, p.x + p.w));
  const y = Math.max(p.y, Math.min(obstacle.y, p.y + p.h));
  assert.ok(Math.hypot(x - obstacle.x, y - obstacle.y) >= obstacle.r);
});
test('non-overlap is checked after clamping near an edge', () => {
  const vp = { w: 240, h: 180, pad: 12 };
  const boxes = placeLabels(vp, [{ id: 'a', x: 220, y: 90, r: 15 }], [label('a'), label('b'), label('c')]);
  disjoint(boxes); boxes.forEach(b => inside(b, vp));
});
test('gap, leader threshold, candidate limit and padding are respected', () => {
  const [p] = placeLabels(viewport, [anchor], [label('one')], { gap: 30, leaderMin: 29, maxCandidates: 1 });
  near(p.x, 450); checkLeader(p, anchor);
  assert.equal(placeLabels(viewport, [anchor], [label('one')], { gap: 30, leaderMin: 30 })[0].leader, null);
  const vp = { w: 180, h: 120, pad: 20 };
  inside(placeLabels(vp, [{ ...anchor, x: 170, y: 60 }], [label('one')])[0], vp);
});
test('frozen inputs are never mutated', () => {
  const a = Object.freeze({ ...anchor });
  const l = Object.freeze(label('one'));
  assert.doesNotThrow(() => placeLabels(Object.freeze({ ...viewport }), Object.freeze([a]), Object.freeze([l]), Object.freeze({ gap: 10 })));
});
test('invalid numbers, duplicate IDs and unknown targets are rejected', () => {
  assert.throws(() => placeLabels({ w: NaN, h: 10 }, [], []), RangeError);
  assert.throws(() => placeLabels(viewport, [anchor], [label('x', { target: 'missing' })]), /target/i);
  assert.throws(() => placeLabels(viewport, [anchor, anchor], []), /duplicate/i);
  assert.throws(() => placeLabels(viewport, [anchor], [label('x'), label('x')]), /duplicate/i);
  assert.throws(() => placeLabels(viewport, [anchor], [label('x', { w: -1 })]), RangeError);
  assert.throws(() => placeLabels(viewport, [anchor], [], { maxCandidates: 0 }), RangeError);
});
test('arrow endpoints lie on both boundaries and angle matches direction', () => {
  const a = { id: 'a', x: 100, y: 100, r: 10 };
  const b = { id: 'b', x: 220, y: 260, r: 20 };
  const p = arrowBetween(viewport, a, b);
  near(p.x1, 106); near(p.y1, 108); near(p.x2, 208); near(p.y2, 244);
  near(Math.hypot(p.x1 - a.x, p.y1 - a.y), 10);
  near(Math.hypot(p.x2 - b.x, p.y2 - b.y), 20);
  near(p.angle, Math.atan2(4, 3));
});
test('arrow inset adds clearance and coincident anchors stay finite', () => {
  const b = { ...anchor, id: 'b', x: 600 };
  const p = arrowBetween(viewport, anchor, b, { inset: 5 });
  near(p.x1, 425); near(p.x2, 575);
  const same = arrowBetween(viewport, anchor, anchor);
  Object.values(same).forEach(n => assert.ok(Number.isFinite(n)));
});
test('rotation path contains an SVG arc and arrowhead with requested sweep', () => {
  const p = rotationArrow(viewport, anchor, 'cw', { sweepDeg: 240, radiusScale: 2 });
  near(p.cx, 400); near(p.cy, 300); near(p.r, 40); near(p.endDeg - p.startDeg, 240);
  assert.match(p.path, /^M [-\d.e+]+ [-\d.e+]+ A [-\d.e+]+ [-\d.e+]+ 0 [01] 1 [-\d.e+]+ [-\d.e+]+ M [-\d.e+]+ [-\d.e+]+ L [-\d.e+]+ [-\d.e+]+ L [-\d.e+]+ [-\d.e+]+$/);
  assert.ok(!/NaN|Infinity/.test(p.path));
});
test('counterclockwise arcs reverse sweep and full circles use two arcs', () => {
  const p = rotationArrow(viewport, anchor, 'ccw', { sweepDeg: 120 });
  near(p.endDeg - p.startDeg, -120); assert.match(p.path, / A \S+ \S+ 0 0 0 /);
  assert.equal((rotationArrow(viewport, anchor, 'cw', { sweepDeg: 360 }).path.match(/ A /g) ?? []).length, 2);
});
test('stretch indicator is centred with requested length and axis', () => {
  const p = stretchIndicator(viewport, anchor, 30, { length: 100 });
  near((p.x1 + p.x2) / 2, anchor.x); near((p.y1 + p.y2) / 2, anchor.y);
  near(Math.hypot(p.x2 - p.x1, p.y2 - p.y1), 100);
  near(Math.atan2(p.y2 - p.y1, p.x2 - p.x1), Math.PI / 6); assert.equal(p.heads, 'both');
});
test('annotation helpers stay inside near edges', () => {
  const vp = { w: 100, h: 80, pad: 8 };
  const a = { id: 'a', x: 10, y: 15, r: 20 };
  const b = { id: 'b', x: 95, y: 70, r: 20 };
  for (const p of [arrowBetween(vp, a, b), stretchIndicator(vp, a, 45, { length: 200 })]) {
    for (const suffix of ['1', '2']) {
      assert.ok(p[`x${suffix}`] >= 8 && p[`x${suffix}`] <= 92);
      assert.ok(p[`y${suffix}`] >= 8 && p[`y${suffix}`] <= 72);
    }
  }
  const arc = rotationArrow(vp, a, 'cw');
  assert.ok(arc.cx - arc.r >= 8 && arc.cy - arc.r >= 8);
  assert.ok(arc.cx + arc.r <= 92 && arc.cy + arc.r <= 72);
});
test('degenerate zero-sized viewport and zero radius stay finite', () => {
  const vp = { w: 0, h: 0 };
  const a = { id: 'a', x: 0, y: 0, r: 0 };
  const [p] = placeLabels(vp, [a], [label('one')]);
  assert.equal(p.clipped, true); near(p.x, 0); near(p.y, 0);
  assert.ok(!/NaN|Infinity/.test(rotationArrow(vp, a, 'cw').path));
});
test('200 labels on 60 anchors place in under 50 ms', () => {
  const ms = benchmark();
  assert.ok(ms < 50, `placement took ${ms.toFixed(3)} ms`);
});
