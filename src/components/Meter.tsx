import { useRef } from 'react';
import { audio } from '../engine/instance';
import { useRaf } from '../hooks/useRaf';

/** Master output level (post-limiter), updated every frame without React re-renders. */
export function Meter({ className = 'meter' }: { className?: string }) {
  const bar = useRef<HTMLSpanElement>(null);
  const level = useRef(0);
  useRaf(() => {
    const { peak } = audio.meter();
    // fast attack, slow release
    level.current = peak > level.current ? peak : level.current * 0.9;
    const db = 20 * Math.log10(Math.max(1e-4, level.current));
    const pct = Math.max(0, Math.min(1, (db + 54) / 54)) * 100;
    if (bar.current) bar.current.style.width = `${pct}%`;
    if (bar.current) bar.current.dataset.level = level.current.toFixed(3);
  });
  return (
    <div className={className} role="meter" aria-label="master level" data-testid="master-meter">
      <span ref={bar} />
    </div>
  );
}
