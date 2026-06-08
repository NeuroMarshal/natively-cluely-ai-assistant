import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useState } from 'react';
import type { OverlayAppearance } from '../../lib/overlayAppearance';

interface ResizeToggleProps {
  /** True when the shell is at its wide width — the button then offers "collapse". */
  expanded: boolean;
  onToggle: () => void;
  appearance: OverlayAppearance;
}

/**
 * Floating glass resize control pinned to the panel's top-right corner.
 *
 * Design (per emil-design-eng spec):
 *  - 26px circular glass button, reusing the overlay icon-surface + jelly-gloss
 *    sheen so it matches the TopPill / send-button language exactly.
 *  - Present-but-quiet at rest (opacity 0.55), blooms to full opacity + scale
 *    1.06 on hover so it's discoverable without a keyboard equivalent yet stays
 *    out of the way (overlay restraint). Hover gated behind a fine pointer.
 *  - Maximize2 ⟷ Minimize2 (the NE+SW dual-diagonal arrows the user asked for).
 *    They cross-fade with a fast scale spring so the arrows "pop" between the
 *    grow / shrink affordance. No rotate (reads as accidental on a diagonal
 *    glyph) and no risky custom-path morph.
 *  - Press compresses to 0.92; release is faster than press (asymmetric timing
 *    is the haptic feel). The icon swap on the same click is the only
 *    state-change confirmation — no extra flash.
 *  - Honors prefers-reduced-motion: instant icon swap, no hover scale.
 *
 * It does NOT own the width animation — onToggle calls the parent's
 * startTransition so manual + automatic expansion share one clock, one curve,
 * and one OS-resize IPC channel.
 */
export default function ResizeToggle({ expanded, onToggle, appearance }: ResizeToggleProps) {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState(false);

  return (
    <motion.button
      type="button"
      onClick={onToggle}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      aria-label={expanded ? 'Collapse panel width' : 'Expand panel width'}
      aria-pressed={expanded}
      title={expanded ? 'Collapse' : 'Expand'}
      className="no-drag absolute top-2 right-2 z-50 flex h-[26px] w-[26px] items-center justify-center overflow-hidden rounded-full overlay-text-interactive"
      style={appearance.iconStyle}
      // Graceful entrance when the button first appears (content lands): fade +
      // a slight scale-up settle, rather than popping in. reduce-motion: fade only.
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
      animate={reduce ? { opacity: hovered ? 1 : 0.55 } : { opacity: hovered ? 1 : 0.55, scale: hovered ? 1.06 : 1 }}
      whileTap={reduce ? undefined : { scale: 0.92 }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
    >
      {/* Jelly-gloss sheen — render above the icon so light catches the arrowheads. */}
      <span className="pointer-events-none absolute inset-x-1 top-0.5 h-[45%] rounded-full bg-gradient-to-b from-white/20 to-white/0 blur-[0.5px]" />
      {/* Optical centering: Maximize2's weight sits low-right, nudge up-left ~0.5px. */}
      <span className="relative flex items-center justify-center" style={{ transform: 'translate(-0.5px, -0.5px)' }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={expanded ? 'collapse' : 'expand'}
            className="flex items-center justify-center"
            initial={reduce ? false : { opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 32 }}
          >
            {expanded ? (
              <Minimize2 className="h-3.5 w-3.5" strokeWidth={2} />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
            )}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.button>
  );
}
