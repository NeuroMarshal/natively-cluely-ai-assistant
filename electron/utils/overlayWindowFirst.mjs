// Window-first overlay resize planner.
//
// WHY THIS EXISTS — the single-clock invariant:
//
// The overlay is a TRANSPARENT, click-through-bordered Electron window whose
// content (a `mx-auto`-centered glass panel) is the only painted region. The
// area inside the window but outside the content is invisible and passes mouse
// events through to the app behind it.
//
// The old architecture animated TWO clocks at once: framer-motion tweened the
// CSS width on the renderer's compositor (rAF) clock, while the main process
// ran a `setInterval(8ms)` timer pushing `setBounds()` on a `Date.now()` clock.
// `setBounds()` is NOT synchronized to the renderer's compositor frames, so no
// matter how identical the width(t) math was, the native frame and the CSS
// content were painted on different, unsynchronizable clocks → visible tearing
// between "the React layer" and "the Electron layer." You cannot win by making
// two clocks chase the same curve.
//
// THE FIX — resize the OS window EXACTLY ONCE (a single atomic setBounds), and
// animate ONLY the CSS panel inside the already-correctly-sized window:
//
//   • EXPAND  (e.g. 600→780): grow the window to the FINAL width FIRST (one
//     atomic, center-preserving setBounds). The extra width is transparent at
//     that instant. Then tween the CSS panel into the space that is already
//     there. Only CSS animates → one clock → zero tearing.
//
//   • COLLAPSE (e.g. 780→600): tween the CSS panel DOWN first (smooth, inside
//     the still-large window), then shrink the window to the final width AFTER
//     the tween completes. Shrinking the window before the content would clip
//     the content for a frame.
//
// This module is the PURE decision: given a width transition, does the single
// window resize happen BEFORE the CSS tween (grow) or AFTER it (shrink)? It is
// dependency-free and imported by the renderer (NativelyInterface.tsx) and by
// node tests. The main process needs no per-frame logic anymore — it just does
// one `setOverlayDimensionsCentered(width, height)` when told.

/**
 * @typedef {Object} WindowResizePlan
 * @property {number} fromWidth        Width at the start of the transition (px).
 * @property {number} toWidth          Target width (px).
 * @property {'grow'|'shrink'|'none'} direction
 *   'grow'   → toWidth > fromWidth (window must be sized up BEFORE the tween).
 *   'shrink' → toWidth < fromWidth (window must be sized down AFTER the tween).
 *   'none'   → no meaningful width change (within EPSILON).
 * @property {'before'|'after'|'none'} windowResizeTiming
 *   When the single atomic native setBounds should fire relative to the CSS
 *   tween. 'before' for grow, 'after' for shrink, 'none' for no-op.
 * @property {boolean} suppressChaseDuringTween
 *   Whether the per-frame width "chase" subscriber must be suspended for the
 *   duration of the CSS tween. Always true for a real resize: the window is
 *   already at (grow) or not yet at (shrink) the target, so the chase must not
 *   second-guess the single authoritative setBounds.
 */

/** Sub-pixel changes are not worth a native setBounds; treat as no-op. */
export const WINDOW_RESIZE_EPSILON_PX = 1;

/**
 * Plan a window-first overlay resize.
 *
 * @param {number} fromWidth current shell width (px)
 * @param {number} toWidth   target shell width (px)
 * @returns {WindowResizePlan}
 */
export function planWindowResize(fromWidth, toWidth) {
  const delta = toWidth - fromWidth;
  if (Math.abs(delta) <= WINDOW_RESIZE_EPSILON_PX) {
    return {
      fromWidth,
      toWidth,
      direction: 'none',
      windowResizeTiming: 'none',
      suppressChaseDuringTween: false,
    };
  }
  if (delta > 0) {
    // GROW: make the room first, then animate the content into it.
    return {
      fromWidth,
      toWidth,
      direction: 'grow',
      windowResizeTiming: 'before',
      suppressChaseDuringTween: true,
    };
  }
  // SHRINK: animate the content down first, then reclaim the room.
  return {
    fromWidth,
    toWidth,
    direction: 'shrink',
    windowResizeTiming: 'after',
    suppressChaseDuringTween: true,
  };
}
