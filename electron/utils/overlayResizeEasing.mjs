// Shared width-resize easing for the overlay shell.
//
// THE SYNC CONTRACT: the renderer (CSS width on the React shell) and the main
// process (native window setBounds) must trace the SAME width over the SAME
// wall-clock duration. They do NOT chase each other over IPC — each side runs
// its own clock and computes width(t) from THIS module. Identical math + a
// shared start signal ⇒ they land on every keyframe together. That is what
// makes the resize look like one object instead of a CSS layer with the OS
// window lagging a frame behind it.
//
// Pure, dependency-free, importable from:
//   • renderer  (src/components/NativelyInterface.tsx)
//   • main      (electron/WindowHelper.ts, via the compiled copy)
//   • node test (src/lib/__tests__/overlayResizeEasing.test.mjs)
//
// MONOTONIC BY CONSTRUCTION: easeOutQuint is strictly non-overshooting, so the
// native window never receives an out-of-range width to snap back from. This
// replaces the old spring (bounce: 0.16), whose overshoot was pushed verbatim
// to setBounds and read as a cheap end-of-animation snap.

/** Total resize duration in milliseconds. 280ms reads as immediate-but-smooth
 *  for ~180px of travel; long enough to feel deliberate, short enough that a
 *  frequent coding-expansion doesn't feel sluggish. */
export const OVERLAY_RESIZE_DURATION_MS = 280;

/**
 * easeOutQuint — fast initial response, long gentle settle, zero overshoot.
 * f(0)=0, f(1)=1, monotonically increasing on [0,1].
 * @param {number} t normalized time in [0,1]
 * @returns {number} eased progress in [0,1]
 */
export function easeOutQuint(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const inv = 1 - t;
  return 1 - inv * inv * inv * inv * inv;
}

/**
 * Interpolated width at a given elapsed time. Both the renderer tween and the
 * main-process timer loop call this with their own `elapsedMs` so they agree
 * on the width at any instant without exchanging per-frame messages.
 *
 * @param {number} fromWidth  width at animation start (px)
 * @param {number} toWidth    target width (px)
 * @param {number} elapsedMs  ms since the shared start instant
 * @param {number} [durationMs=OVERLAY_RESIZE_DURATION_MS]
 * @returns {number} current width (px), clamped to the [from,to] envelope
 */
export function widthAt(fromWidth, toWidth, elapsedMs, durationMs = OVERLAY_RESIZE_DURATION_MS) {
  if (durationMs <= 0) return toWidth;
  const t = elapsedMs <= 0 ? 0 : elapsedMs >= durationMs ? 1 : elapsedMs / durationMs;
  return fromWidth + (toWidth - fromWidth) * easeOutQuint(t);
}

/**
 * True once the animation has reached or passed its end instant.
 * @param {number} elapsedMs
 * @param {number} [durationMs=OVERLAY_RESIZE_DURATION_MS]
 */
export function isResizeComplete(elapsedMs, durationMs = OVERLAY_RESIZE_DURATION_MS) {
  return elapsedMs >= durationMs;
}
