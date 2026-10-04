import { useEffect, useRef } from 'react';

/** Runs `cb(now)` on every animation frame while mounted. The callback can change freely. */
export function useRaf(cb: (now: number) => void, active = true): void {
  const ref = useRef(cb);
  useEffect(() => {
    ref.current = cb;
  });
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const loop = (now: number) => {
      ref.current(now);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [active]);
}
