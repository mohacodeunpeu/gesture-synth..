import { memo, useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { performer, sampler } from '../../engine/instance';
import { triggersForPad } from '../../engine/GestureMapper';
import { Performance } from '../../engine/Performance';
import { PAD_COLORS, padKeyCode, type PadConfig } from '../../engine/projectTypes';
import type { TriggerDef } from '../../engine/mappingTypes';
import { useRaf } from '../../hooks/useRaf';
import { useT } from '../../hooks/useT';
import { activeBank, useProject } from '../../store/projectStore';
import { useSession } from '../../store/sessionStore';
import { useSettings } from '../../store/settingsStore';
import { GESTURE_EMOJI, MOTION_EMOJI } from '../../vision/gestureTypes';
import { importToPad } from './importSound';
import './pads.css';

const LONG_PRESS_MS = 520;

export function PadGrid() {
  const project = useProject((s) => s.project);
  const bank = activeBank(project);
  const mapping = project.mappings[project.mode];
  const keyLabels = useSession((s) => s.keyLabels);
  const learnPad = useSession((s) => s.learnPad);
  const selectedPad = useSession((s) => s.selectedPad);
  const drawer = useSession((s) => s.drawer);
  const padEls = useRef<Array<HTMLDivElement | null>>([]);
  const progEls = useRef<Array<HTMLSpanElement | null>>([]);
  const lastProg = useRef<number[]>([]);

  // hit animations come straight from the engine (no React render in the hot path)
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const offHit = performer.events.on('padHit', (e) => {
      if (e.bankId !== bank.id) return;
      const el = padEls.current[e.pad];
      if (!el) return;
      el.dataset.hits = String(Number(el.dataset.hits ?? 0) + 1);
      el.dataset.result = e.result;
      if (e.result === 'played' || e.result === 'loading') {
        el.animate(
          reduce
            ? [{ filter: 'brightness(1.7)' }, { filter: 'brightness(1)' }]
            : [
                { transform: 'scale(0.92)', filter: 'brightness(1.9)' },
                { transform: 'scale(1.03)', filter: 'brightness(1.3)', offset: 0.35 },
                { transform: 'scale(1)', filter: 'brightness(1)' },
              ],
          { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' },
        );
        el.querySelector('.pad-flash')?.animate([{ opacity: 0.95 }, { opacity: 0 }], { duration: 420, easing: 'ease-out' });
      } else if (!reduce) {
        el.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }], { duration: 240 });
      }
    });
    return offHit;
  }, [bank.id]);

  // playback progress bars
  useRaf(() => {
    for (let i = 0; i < 16; i++) {
      const p = sampler.progress(Performance.padKey(bank.id, i));
      const v = p === null ? -1 : Math.round(p * 100);
      if (lastProg.current[i] === v) continue;
      lastProg.current[i] = v;
      const el = progEls.current[i];
      const pad = padEls.current[i];
      if (el) el.style.width = v < 0 ? '0%' : `${v}%`;
      if (pad) pad.classList.toggle('playing', v >= 0);
    }
  });

  return (
    <section className="pads" aria-label="pads" data-bank={bank.id}>
      {bank.pads.map((pad, i) => (
        <Pad
          key={`${bank.id}-${i}`}
          index={i}
          bankId={bank.id}
          pad={pad}
          keyLabel={keyLabels[padKeyCode(pad, i)] ?? padKeyCode(pad, i).replace(/^(Key|Digit)/, '')}
          triggers={triggersForPad(mapping, i)}
          learning={learnPad === i}
          selected={drawer === 'pad' && selectedPad === i}
          padRef={(el) => {
            padEls.current[i] = el;
          }}
          progressRef={(el) => {
            progEls.current[i] = el;
          }}
        />
      ))}
    </section>
  );
}

interface PadProps {
  index: number;
  bankId: string;
  pad: PadConfig;
  keyLabel: string;
  triggers: TriggerDef[];
  learning: boolean;
  selected: boolean;
  padRef: (el: HTMLDivElement | null) => void;
  progressRef: (el: HTMLSpanElement | null) => void;
}

const Pad = memo(function Pad({ index, bankId, pad, keyLabel, triggers, learning, selected, padRef, progressRef }: PadProps) {
  const t = useT();
  const lang = useSettings((s) => s.lang);
  const fileRef = useRef<HTMLInputElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const empty = !pad.sample;
  const color = PAD_COLORS[pad.color % PAD_COLORS.length];
  const trig = triggers[0];
  const badge = trig
    ? `${trig.kind === 'gesture' ? GESTURE_EMOJI[trig.gesture] : MOTION_EMOJI[trig.motion]}${trig.hand === 'Any' ? '' : trig.hand === 'Left' ? (lang === 'fr' ? 'G' : 'L') : lang === 'fr' ? 'D' : 'R'}`
    : null;

  const openEditor = () => useSession.getState().openDrawer('pad', index);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.pad-edit')) return;
    useSession.getState().selectPad(index);
    if (empty) {
      fileRef.current?.click();
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    performer.triggerPad(index, 'pointer', { velocity: e.pointerType === 'pen' && e.pressure > 0 ? Math.max(0.4, e.pressure) : 1 });
    if (e.pointerType === 'touch') pressTimer.current = setTimeout(openEditor, LONG_PRESS_MS);
  };

  const onPointerUp = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
    if (!empty) performer.releasePad(index);
  };

  return (
    <div
      ref={padRef}
      className={`pad ${empty ? 'empty' : ''} ${learning ? 'learning' : ''} ${selected ? 'selected' : ''} ${dragOver ? 'drag-over' : ''}`}
      style={{ '--pad': color } as React.CSSProperties}
      role="button"
      tabIndex={-1}
      aria-label={pad.name || t('pad', { n: index + 1 })}
      data-testid={`pad-${index}`}
      data-hits="0"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => {
        e.preventDefault();
        openEditor();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void importToPad(file, bankId, index);
      }}
    >
      <span className="pad-flash" aria-hidden />
      <span className="pad-key mono">{keyLabel}</span>
      {badge && (
        <span className="pad-gesture" title={trig?.kind === 'gesture' ? t(`g_${trig.gesture}`) : undefined}>
          {badge}
        </span>
      )}
      {empty ? (
        <span className="pad-empty">
          <span className="pad-plus">+</span>
          <span>{dragOver ? t('dropToReplace') : t('dropHere')}</span>
        </span>
      ) : (
        <>
          <span className="pad-emoji" aria-hidden>
            {pad.emoji}
          </span>
          <span className="pad-name">{pad.name}</span>
        </>
      )}
      {dragOver && !empty && <span className="pad-drop">{t('dropToReplace')}</span>}
      <button
        className="pad-edit"
        aria-label={t('editPad')}
        title={t('editPad')}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          openEditor();
        }}
      >
        <MoreHorizontal size={16} />
      </button>
      <span className="pad-progress" ref={progressRef} />
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.webm,.opus"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void importToPad(file, bankId, index);
        }}
      />
    </div>
  );
});
