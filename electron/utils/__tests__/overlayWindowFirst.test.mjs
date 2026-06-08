import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWindowResize, WINDOW_RESIZE_EPSILON_PX } from '../overlayWindowFirst.mjs';

test('grow: window resizes BEFORE the CSS tween (make room first)', () => {
  const p = planWindowResize(600, 780);
  assert.equal(p.direction, 'grow');
  assert.equal(p.windowResizeTiming, 'before');
  assert.equal(p.suppressChaseDuringTween, true);
  assert.equal(p.fromWidth, 600);
  assert.equal(p.toWidth, 780);
});

test('shrink: window resizes AFTER the CSS tween (reclaim room last)', () => {
  const p = planWindowResize(780, 600);
  assert.equal(p.direction, 'shrink');
  assert.equal(p.windowResizeTiming, 'after');
  assert.equal(p.suppressChaseDuringTween, true);
});

test('no-op: identical widths produce no native resize and no chase suppression', () => {
  const p = planWindowResize(600, 600);
  assert.equal(p.direction, 'none');
  assert.equal(p.windowResizeTiming, 'none');
  assert.equal(p.suppressChaseDuringTween, false);
});

test('sub-pixel deltas within epsilon are treated as no-op', () => {
  const p = planWindowResize(600, 600 + WINDOW_RESIZE_EPSILON_PX);
  assert.equal(p.direction, 'none');
  assert.equal(p.windowResizeTiming, 'none');
});

test('a delta just past epsilon is a real resize', () => {
  const grow = planWindowResize(600, 600 + WINDOW_RESIZE_EPSILON_PX + 0.5);
  assert.equal(grow.direction, 'grow');
  const shrink = planWindowResize(600, 600 - WINDOW_RESIZE_EPSILON_PX - 0.5);
  assert.equal(shrink.direction, 'shrink');
});

test('grow timing "before" never clips: window is at target while CSS is still small', () => {
  // Invariant doc: on grow we set the window to toWidth first; the content is
  // still fromWidth, centered, so the surplus is transparent. The plan must put
  // the native resize BEFORE so the content always has room to animate into.
  const p = planWindowResize(600, 780);
  assert.equal(p.windowResizeTiming, 'before');
});

test('shrink timing "after" never clips: content reaches target before window shrinks', () => {
  // Invariant doc: on shrink we must NOT shrink the window until the CSS panel
  // has finished animating down, or the content is clipped for a frame.
  const p = planWindowResize(780, 600);
  assert.equal(p.windowResizeTiming, 'after');
});
