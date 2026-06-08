// premium/src/NegotiationCoachingCard.tsx
//
// Open-source local re-implementation. Part of the AGPL-3.0 Natively fork.
//
// In-meeting live negotiation coaching card: a tactical note, an exact
// speak-aloud script, the offer/target numbers, and an optional silence-
// countdown timer. Rendered in the meeting message list during a comp thread.

import React from 'react';

interface NegotiationCoachingCardProps {
  tacticalNote?: string;
  exactScript?: string;
  showSilenceTimer?: boolean;
  phase?: string;
  theirOffer?: number | null;
  yourTarget?: number | null;
  currency?: string;
  interfaceTheme?: any;
  isLightTheme?: boolean;
  onSilenceTimerEnd?: () => void;
}

const SILENCE_SECONDS = 8;

function fmtMoney(value: number | null | undefined, currency = '$'): string | null {
  if (value == null || Number.isNaN(value)) return null;
  return `${currency}${value.toLocaleString()}`;
}

export const NegotiationCoachingCard: React.FC<NegotiationCoachingCardProps> = ({
  tacticalNote,
  exactScript,
  showSilenceTimer,
  phase,
  theirOffer,
  yourTarget,
  currency = '$',
  isLightTheme,
  onSilenceTimerEnd,
}) => {
  const [remaining, setRemaining] = React.useState(SILENCE_SECONDS);

  React.useEffect(() => {
    if (!showSilenceTimer) return;
    setRemaining(SILENCE_SECONDS);
    const started = Date.now();
    const id = setInterval(() => {
      const left = SILENCE_SECONDS - Math.floor((Date.now() - started) / 1000);
      if (left <= 0) {
        clearInterval(id);
        setRemaining(0);
        onSilenceTimerEnd?.();
      } else {
        setRemaining(left);
      }
    }, 250);
    return () => clearInterval(id);
  }, [showSilenceTimer, onSilenceTimerEnd]);

  const base = isLightTheme
    ? 'border-amber-500/30 bg-amber-50 text-amber-950'
    : 'border-amber-400/30 bg-amber-400/10 text-amber-100';
  const their = fmtMoney(theirOffer, currency);
  const target = fmtMoney(yourTarget, currency);

  return (
    <div className={`rounded-xl border p-3.5 ${base}`}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide opacity-70">
          Negotiation{phase ? ` · ${phase}` : ''}
        </span>
        {showSilenceTimer && remaining > 0 && (
          <span className="rounded-full bg-black/10 px-2 py-0.5 text-[11px] tabular-nums">
            stay silent {remaining}s
          </span>
        )}
      </div>

      {tacticalNote && <div className="text-sm font-medium leading-snug">{tacticalNote}</div>}

      {exactScript && (
        <div className="mt-2 rounded-lg bg-black/10 px-3 py-2 text-sm italic leading-snug">
          “{exactScript}”
        </div>
      )}

      {(their || target) && (
        <div className="mt-2 flex gap-4 text-xs opacity-80">
          {their && <span>Their offer: <b>{their}</b></span>}
          {target && <span>Your target: <b>{target}</b></span>}
        </div>
      )}
    </div>
  );
};

export default NegotiationCoachingCard;
