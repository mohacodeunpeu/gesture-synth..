import { useEffect, useRef } from 'react';
import { library } from '../../engine/instance';

interface Props {
  sampleRef: string;
  duration: number;
  trimStart: number;
  trimEnd: number;
  reverse: boolean;
  onTrim: (start: number, end: number) => void;
}

/** Waveform with draggable trim handles. */
export function Waveform({ sampleRef, duration, trimStart, trimEnd, reverse, onTrim }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<'start' | 'end' | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const buckets = Math.max(32, Math.floor(w / 2));
    const peaks = library.peaks(sampleRef, buckets);
    const color = getComputedStyle(canvas).getPropertyValue('--pad').trim() || '#22e5ff';
    const end = trimEnd > 0 ? trimEnd : duration;
    const x0 = (trimStart / duration) * w;
    const x1 = (end / duration) * w;
    if (peaks) {
      for (let b = 0; b < buckets; b++) {
        const i = reverse ? buckets - 1 - b : b;
        const min = peaks[i * 2];
        const max = peaks[i * 2 + 1];
        const x = (b / buckets) * w;
        const inside = x >= x0 && x <= x1;
        ctx.fillStyle = inside ? color : 'rgba(255,255,255,0.18)';
        const y0 = h / 2 - max * (h / 2 - 2);
        const y1 = h / 2 - min * (h / 2 - 2);
        ctx.fillRect(x, y0, Math.max(1, w / buckets - 0.5), Math.max(1, y1 - y0));
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, x0, h);
    ctx.fillRect(x1, 0, w - x1, h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x0 - 1, 0, 2, h);
    ctx.fillRect(x1 - 1, 0, 2, h);
  }, [sampleRef, duration, trimStart, trimEnd, reverse]);

  const timeAt = (clientX: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration));
  };

  return (
    <canvas
      ref={canvasRef}
      className="waveform"
      onPointerDown={(e) => {
        const tm = timeAt(e.clientX);
        const end = trimEnd > 0 ? trimEnd : duration;
        drag.current = Math.abs(tm - trimStart) <= Math.abs(tm - end) ? 'start' : 'end';
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const tm = timeAt(e.clientX);
        const end = trimEnd > 0 ? trimEnd : duration;
        if (drag.current === 'start') onTrim(Math.min(tm, end - 0.01), trimEnd);
        else onTrim(trimStart, tm >= duration - 0.002 ? 0 : Math.max(tm, trimStart + 0.01));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
    />
  );
}
