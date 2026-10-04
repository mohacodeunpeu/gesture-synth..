import { HAND_CONNECTIONS, type Vec3 } from '../../vision/gestureTypes';

/** Maps normalised display coordinates to stage pixels for an `object-fit: cover` video. */
export interface CoverMap {
  ox: number;
  oy: number;
  w: number;
  h: number;
}

export function coverMap(stageW: number, stageH: number, videoW: number, videoH: number): CoverMap {
  if (!videoW || !videoH) return { ox: 0, oy: 0, w: stageW, h: stageH };
  const s = Math.max(stageW / videoW, stageH / videoH);
  const w = videoW * s;
  const h = videoH * s;
  return { ox: (stageW - w) / 2, oy: (stageH - h) / 2, w, h };
}

export const toPx = (m: CoverMap, x: number, y: number): [number, number] => [m.ox + x * m.w, m.oy + y * m.h];

const FINGERTIPS = [4, 8, 12, 16, 20];
const PALM = [0, 1, 5, 9, 13, 17];

export function drawHand(
  ctx: CanvasRenderingContext2D,
  lm: readonly Vec3[],
  map: CoverMap,
  color: string,
  opts: { active: boolean; label: string; level: number },
): { top: number; cx: number } {
  const pts = lm.map((p) => toPx(map, p.x, p.y));
  const palmPx = Math.hypot(pts[9][0] - pts[0][0], pts[9][1] - pts[0][1]);
  const w = Math.max(2, Math.min(7, palmPx * 0.045));

  // palm glow
  ctx.beginPath();
  PALM.forEach((i, k) => (k ? ctx.lineTo(pts[i][0], pts[i][1]) : ctx.moveTo(pts[i][0], pts[i][1])));
  ctx.closePath();
  ctx.fillStyle = withAlpha(color, 0.08 + opts.level * 0.15);
  ctx.fill();

  // bones: wide translucent pass (glow) + crisp pass
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.moveTo(pts[a][0], pts[a][1]);
    ctx.lineTo(pts[b][0], pts[b][1]);
  }
  ctx.strokeStyle = withAlpha(color, opts.active ? 0.38 : 0.22);
  ctx.lineWidth = w * 3.4;
  ctx.stroke();
  ctx.strokeStyle = withAlpha(color, 0.95);
  ctx.lineWidth = w;
  ctx.stroke();

  // joints
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i < pts.length; i++) {
    if (FINGERTIPS.includes(i)) continue;
    ctx.beginPath();
    ctx.arc(pts[i][0], pts[i][1], w * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const i of FINGERTIPS) {
    const r = w * (opts.active ? 1.9 : 1.5);
    ctx.beginPath();
    ctx.arc(pts[i][0], pts[i][1], r * 2.1, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(color, 0.22);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(pts[i][0], pts[i][1], r, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }

  // label pill under the wrist
  let top = Infinity;
  let cx = 0;
  for (const p of pts) {
    top = Math.min(top, p[1]);
    cx += p[0];
  }
  cx /= pts.length;
  const [wx, wy] = pts[0];
  pill(ctx, opts.label, wx, wy + w * 4 + 14, color);
  return { top, cx };
}

export function pill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, size = 13) {
  ctx.font = `700 ${size}px "Space Grotesk Variable", system-ui, sans-serif`;
  const tw = ctx.measureText(text).width;
  const h = size + 12;
  const wpx = tw + 18;
  ctx.beginPath();
  ctx.roundRect(x - wpx / 2, y - h / 2, wpx, h, h / 2);
  ctx.fillStyle = 'rgba(5,6,10,0.78)';
  ctx.fill();
  ctx.strokeStyle = withAlpha(color, 0.8);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 1);
}

export function withAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

// -------------------------------------------------------------------------------------------
// Particles & bubbles
// -------------------------------------------------------------------------------------------

interface Particle {
  kind: 'emoji' | 'ring' | 'spark';
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  rot: number;
  vr: number;
  text: string;
  color: string;
}

interface Bubble {
  text: string;
  x: number;
  y: number;
  color: string;
  age: number;
  life: number;
}

export class FxLayer {
  private particles: Particle[] = [];
  private bubbles: Bubble[] = [];
  reduced = false;

  burst(x: number, y: number, emoji: string, color: string, intensity = 1) {
    const n = this.reduced ? 3 : Math.round(8 + 6 * intensity);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
      const speed = (this.reduced ? 120 : 260 + Math.random() * 380) * (0.6 + 0.4 * intensity);
      this.particles.push({
        kind: i % 3 === 2 ? 'spark' : 'emoji',
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        age: 0,
        life: 0.8 + Math.random() * 0.5,
        size: 22 + Math.random() * 20,
        rot: (Math.random() - 0.5) * 0.6,
        vr: (Math.random() - 0.5) * 6,
        text: emoji,
        color,
      });
    }
    if (!this.reduced) {
      this.particles.push({ kind: 'ring', x, y, vx: 0, vy: 0, age: 0, life: 0.5, size: 30, rot: 0, vr: 0, text: '', color });
      this.particles.push({ kind: 'ring', x, y, vx: 0, vy: 0, age: -0.08, life: 0.6, size: 16, rot: 0, vr: 0, text: '', color: '#ffffff' });
    }
    if (this.particles.length > 260) this.particles.splice(0, this.particles.length - 260);
  }

  bubble(text: string, x: number, y: number, color: string) {
    this.bubbles.push({ text, x, y, color, age: 0, life: 1.1 });
    if (this.bubbles.length > 6) this.bubbles.shift();
  }

  get busy(): boolean {
    return this.particles.length > 0 || this.bubbles.length > 0;
  }

  update(dt: number) {
    for (const p of this.particles) {
      p.age += dt;
      if (p.age < 0) continue;
      p.vy += 900 * dt * (p.kind === 'spark' ? 0.5 : 1);
      p.vx *= 1 - 1.2 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    for (const b of this.bubbles) b.age += dt;
    this.bubbles = this.bubbles.filter((b) => b.age < b.life);
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      if (p.age < 0) continue;
      const k = p.age / p.life;
      const alpha = 1 - k * k;
      if (p.kind === 'ring') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size + k * 150, 0, Math.PI * 2);
        ctx.strokeStyle = withAlpha(p.color, alpha * 0.8);
        ctx.lineWidth = 4 * (1 - k) + 1;
        ctx.stroke();
      } else if (p.kind === 'spark') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5 * (1 - k) + 1, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(p.color, alpha);
        ctx.fill();
      } else {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.font = `${p.size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
      }
    }
    for (const b of this.bubbles) {
      const k = b.age / b.life;
      const appear = Math.min(1, b.age / 0.12);
      const scale = 0.7 + 0.3 * appear + (this.reduced ? 0 : 0.06 * Math.sin(Math.min(1, b.age / 0.25) * Math.PI));
      ctx.save();
      ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      ctx.translate(b.x, b.y - (this.reduced ? 0 : 46 * k));
      ctx.scale(scale, scale);
      pill(ctx, b.text, 0, 0, b.color, 20);
      ctx.restore();
    }
  }
}
