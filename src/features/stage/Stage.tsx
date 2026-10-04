import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Camera, RefreshCw, X } from 'lucide-react';
import { startCamera } from '../../app/boot';
import { audio, gestures, performer, tracker } from '../../engine/instance';
import type { ActionDef, DiscreteRule } from '../../engine/mappingTypes';
import { PAD_COLORS } from '../../engine/projectTypes';
import { useTrackerInfo } from '../../hooks/useEngines';
import { useRaf } from '../../hooks/useRaf';
import { useT } from '../../hooks/useT';
import type { DictKey, TFn } from '../../i18n';
import { activeBank, useProject } from '../../store/projectStore';
import { useSettings } from '../../store/settingsStore';
import { GESTURE_EMOJI, MOTION_EMOJI, type HandSide } from '../../vision/gestureTypes';
import { FxLayer, coverMap, drawHand, toPx } from './stageRenderer';
import './stage.css';

const HAND_COLOR: Record<HandSide, string> = { Right: '#22e5ff', Left: '#2dffb4' };

export function Stage() {
  const t = useT();
  const info = useTrackerInfo();
  const mirror = useSettings((s) => s.mirror);
  const showSkeleton = useSettings((s) => s.showSkeleton);
  const showCheat = useSettings((s) => s.showCheatSheet);
  const lang = useSettings((s) => s.lang);
  const project = useProject((s) => s.project);
  const bank = activeBank(project);
  const rules = project.mappings[project.mode].discrete;

  const rootRef = useRef<HTMLDivElement>(null);
  const videoSlot = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const cheatRef = useRef<HTMLDivElement>(null);
  const fx = useRef(new FxLayer());
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const lastT = useRef(0);
  const handsSeenAt = useRef(0);
  const level = useRef(0);

  // adopt the tracker's <video> element into the stage
  useEffect(() => {
    const slot = videoSlot.current;
    if (!slot) return;
    const v = tracker.video;
    const park = v.parentElement;
    slot.appendChild(v);
    void v.play().catch(() => undefined);
    return () => {
      if (park) park.appendChild(v);
      else v.remove();
    };
  }, []);

  // canvas sizing
  useEffect(() => {
    const el = rootRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { w: r.width, h: r.height, dpr };
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
    });
    ro.observe(el);
    fx.current.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return () => ro.disconnect();
  }, []);

  // feedback events → particles and bubbles
  useEffect(() => {
    const posFor = (x?: number, y?: number): [number, number] => {
      const { w, h } = size.current;
      if (x === undefined || y === undefined) return [w * (0.3 + Math.random() * 0.4), h * (0.45 + Math.random() * 0.25)];
      const map = coverMap(w, h, tracker.video.videoWidth, tracker.video.videoHeight);
      return toPx(map, x, y);
    };
    const offHit = performer.events.on('padHit', (e) => {
      if (e.result !== 'played' && e.result !== 'loading') return;
      const b = useProject.getState().project.banks.find((bb) => bb.id === e.bankId);
      const pad = b?.pads[e.pad];
      if (!pad) return;
      const [px, py] = posFor(e.x, e.y);
      fx.current.burst(px, py, pad.emoji, PAD_COLORS[pad.color % PAD_COLORS.length], e.velocity);
    });
    const offGesture = performer.events.on('gestureFired', (e) => {
      if (!e.rules.length) return;
      const [px, py] = posFor(e.x, e.y);
      const label = describeAction(e.rules[0].action, t);
      fx.current.bubble(`${e.emoji} ${label}`, px, Math.max(40, py - size.current.h * 0.16), HAND_COLOR[e.hand]);
    });
    const offStop = performer.events.on('stopAll', () => {
      const { w, h } = size.current;
      fx.current.bubble(`✋ ${t('a_stopAll')}`, w / 2, h / 2, '#ffffff');
    });
    return () => {
      offHit();
      offGesture();
      offStop();
    };
  }, [t]);

  useRaf((now) => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;
    const dt = lastT.current ? Math.min(0.05, (now - lastT.current) / 1000) : 0;
    lastT.current = now;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { w, h, dpr } = size.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // audio-reactive frame glow
    const { peak } = audio.meter();
    level.current = peak > level.current ? peak : level.current * 0.92;
    root.style.setProperty('--level', level.current.toFixed(3));

    const map = coverMap(w, h, tracker.video.videoWidth, tracker.video.videoHeight);
    let anyHand = false;
    for (const side of ['Left', 'Right'] as const) {
      const hand = gestures.hands[side];
      if (!hand.present || hand.landmarks.length !== 21) continue;
      anyHand = true;
      if (!showSkeleton) continue;
      const letter = side === 'Left' ? (lang === 'fr' ? 'G' : 'L') : lang === 'fr' ? 'D' : 'R';
      const g = hand.stable !== 'NONE' ? ` ${GESTURE_EMOJI[hand.stable]}` : '';
      drawHand(ctx, hand.landmarks, map, HAND_COLOR[side], { active: hand.stable !== 'NONE', label: `${letter}${g}`, level: level.current });
    }
    if (anyHand) handsSeenAt.current = now;

    fx.current.update(dt);
    fx.current.draw(ctx);

    // "show your hand" hint + cheat-sheet highlighting, without React renders
    const showHint = tracker.isLive && now - handsSeenAt.current > 1500;
    hintRef.current?.classList.toggle('visible', showHint);
    root.dataset.hands = String(Number(gestures.hands.Left.present) + Number(gestures.hands.Right.present));
    const cheat = cheatRef.current;
    if (cheat) {
      for (const row of cheat.querySelectorAll<HTMLElement>('[data-gesture]')) {
        const hand = row.dataset.hand as HandSide | 'Any';
        const gest = row.dataset.gesture;
        const on = (hand === 'Any' ? (['Left', 'Right'] as const) : [hand]).some((s) => gestures.hands[s].stable === gest);
        row.classList.toggle('on', on);
      }
    }
  });

  return (
    <section className={`stage ${mirror ? 'mirrored' : ''}`} ref={rootRef} data-testid="stage">
      <div className="video-slot" ref={videoSlot} />
      <div className="stage-grid" aria-hidden />
      <canvas className="stage-canvas" ref={canvasRef} />

      <div className="stage-hint" ref={hintRef}>
        <span className="hint-hand">✋</span>
        <span>{t('showHand')}</span>
      </div>

      {showCheat && rules.length > 0 && <CheatSheet rules={rules} t={t} bankName={bank.name} innerRef={cheatRef} lang={lang} />}

      <CameraOverlay status={info.camera} error={info.cameraError} t={t} />
      <ModelStatus model={info.model} progress={info.modelProgress} cameraLive={info.camera === 'live'} t={t} />
      <SwapHint t={t} />
    </section>
  );
}

function describeAction(a: ActionDef, t: TFn): string {
  if (a.type === 'pad') {
    const { project } = useProject.getState();
    const pad = activeBank(project).pads[a.pad];
    return pad?.sample ? `${pad.emoji} ${pad.name}` : t('pad', { n: a.pad + 1 });
  }
  return t(`a_${a.type}` as DictKey);
}

function CheatSheet({ rules, t, innerRef, lang }: { rules: DiscreteRule[]; t: TFn; bankName: string; innerRef: React.RefObject<HTMLDivElement | null>; lang: string }) {
  // expanded on large screens, folded into a chip on phones (it would cover the camera)
  const [open, setOpen] = useState(() => window.matchMedia('(min-width: 881px)').matches);
  const project = useProject((s) => s.project);
  const groups = useMemo(() => {
    const out: Record<'Right' | 'Left' | 'Any', Array<{ id: string; emoji: string; gesture: string; handSel: string; label: string }>> = { Right: [], Left: [], Any: [] };
    for (const r of rules) {
      const trig = r.trigger;
      out[trig.hand].push({
        id: r.id,
        emoji: trig.kind === 'gesture' ? GESTURE_EMOJI[trig.gesture] : MOTION_EMOJI[trig.motion],
        gesture: trig.kind === 'gesture' ? trig.gesture : trig.motion,
        handSel: trig.hand,
        label: describeAction(r.action, t),
      });
    }
    return out;
    // project: pad names may change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules, t, lang, project]);

  if (!open) {
    return (
      <button className="cheat-toggle" onClick={() => setOpen(true)} data-testid="cheat-open">
        ✋ {t('cheatTitle')}
      </button>
    );
  }
  const col = (side: 'Right' | 'Left' | 'Any') =>
    groups[side].length > 0 && (
      <div className="cheat-col" key={side}>
        <div className="cheat-hand" data-side={side}>
          {side === 'Any' ? t('anyHand') : `${t(side === 'Left' ? 'left' : 'right')} (${t(side === 'Left' ? 'leftShort' : 'rightShort')})`}
        </div>
        <ul>
          {groups[side].map((r) => (
            <li key={r.id} data-gesture={r.gesture} data-hand={r.handSel}>
              <span className="cheat-g">{r.emoji}</span>
              <span className="cheat-a">{r.label}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="cheat" ref={innerRef} data-testid="cheat">
      <div className="cheat-head">
        <span>{t('cheatTitle')}</span>
        <button className="btn btn-ghost btn-icon btn-sm" aria-label={t('hide')} onClick={() => setOpen(false)}>
          <X size={14} />
        </button>
      </div>
      <div className="cheat-cols">
        {col('Right')}
        {col('Left')}
      </div>
      {col('Any')}
    </div>
  );
}

function CameraOverlay({ status, error, t }: { status: string; error: string | null; t: TFn }) {
  if (status === 'live') return null;
  if (status === 'requesting') {
    return (
      <div className="stage-card subtle">
        <RefreshCw className="spin" size={22} />
        <p>{t('camStarting')}</p>
      </div>
    );
  }
  const msg: DictKey =
    status === 'denied'
      ? 'camDeniedMsg'
      : status === 'notfound'
        ? 'camNotFoundMsg'
        : status === 'inuse'
          ? 'camInUseMsg'
          : status === 'unsupported'
            ? 'camInsecureMsg'
            : 'camErrorMsg';
  return (
    <div className="stage-card" data-testid="camera-card" data-status={status}>
      <Camera size={30} />
      <p>{status === 'off' ? t('cam_off') : t(msg)}</p>
      {status !== 'unsupported' && (
        <button className="btn btn-primary" onClick={() => void startCamera()}>
          <RefreshCw size={16} /> {t('retry')}
        </button>
      )}
      {error && status !== 'off' && <small className="mono dim">{error}</small>}
    </div>
  );
}

function ModelStatus({ model, progress, cameraLive, t }: { model: string; progress: number; cameraLive: boolean; t: TFn }) {
  if (model === 'ready' || !cameraLive) return null;
  if (model === 'error') {
    return (
      <div className="model-bar error">
        <span>{t('modelError')}</span>
        <button className="btn btn-sm" onClick={() => void tracker.loadModel()}>
          {t('retry')}
        </button>
      </div>
    );
  }
  return (
    <div className="model-bar" data-testid="model-loading">
      <span>{t('modelLoading', { pct: Math.round(progress * 100) })}</span>
      <span className="model-progress">
        <span style={{ width: `${Math.max(4, progress * 100)}%` }} />
      </span>
    </div>
  );
}

/** Quick fix when MediaPipe's left/right is wrong for this camera. */
function SwapHint({ t }: { t: TFn }) {
  const swap = useSettings((s) => s.swapHands);
  const set = useSettings((s) => s.set);
  return (
    <button className="swap-btn" onClick={() => set({ swapHands: !swap })} title={t('swapHandsQuick')}>
      <ArrowLeftRight size={14} />
      <span>{t('swapHandsQuick')}</span>
    </button>
  );
}
