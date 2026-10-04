import { useEffect, useRef, useState } from 'react';
import { Hand, Play, RotateCcw, Trash2, Upload } from 'lucide-react';
import { BUILTIN_BANKS, builtinRef, findBuiltin } from '../../audio/sfx/index';
import { library, performer } from '../../engine/instance';
import { triggersForPad } from '../../engine/GestureMapper';
import { PAD_COLORS, PAD_MODES, padKeyCode, type PadConfig } from '../../engine/projectTypes';
import { useLibraryVersion } from '../../hooks/useEngines';
import { useT } from '../../hooks/useT';
import type { DictKey } from '../../i18n';
import { activeBank, useProject } from '../../store/projectStore';
import { useSession } from '../../store/sessionStore';
import { GESTURE_EMOJI, MOTION_EMOJI } from '../../vision/gestureTypes';
import { importToPad } from './importSound';
import { Waveform } from './Waveform';
import './editor.css';

const EMOJIS = ['🎵', '💀', '😂', '🔥', '💥', '🚨', '🐐', '🤡', '👽', '🎺', '🥁', '🎤', '🐸', '🦆', '🍑', '⚡', '💎', '🚀', '😱', '🤯', '🙃', '😎', '🫡', '🗿'];

export function PadEditor() {
  const t = useT();
  const project = useProject((s) => s.project);
  const updatePad = useProject((s) => s.updatePad);
  const index = useSession((s) => s.selectedPad);
  const learnPad = useSession((s) => s.learnPad);
  const keyLabels = useSession((s) => s.keyLabels);
  const bank = activeBank(project);
  const pad = bank.pads[index];
  const fileRef = useRef<HTMLInputElement>(null);
  const [capturing, setCapturing] = useState(false);
  useLibraryVersion();

  // make sure the sample is decoded so the waveform can be drawn
  useEffect(() => {
    if (pad?.sample) void library.load(pad.sample);
  }, [pad?.sample]);

  if (!pad) return null;
  const patch = (p: Partial<PadConfig>) => updatePad(bank.id, index, p);
  const buffer = pad.sample ? library.get(pad.sample) : undefined;
  const duration = buffer?.duration ?? 0;
  const triggers = triggersForPad(project.mappings[project.mode], index);
  const userSamples = library.listUserSamples();
  const color = PAD_COLORS[pad.color % PAD_COLORS.length];
  const handName = (h: string) => (h === 'Any' ? t('anyHand') : t(h === 'Left' ? 'left' : 'right'));

  return (
    <div className="editor" style={{ '--pad': color } as React.CSSProperties} data-testid="pad-editor">
      <div className="pad-picker" role="group" aria-label="pads">
        {bank.pads.map((p, i) => (
          <button key={i} aria-pressed={i === index} onClick={() => useSession.getState().selectPad(i)} title={p.name || String(i + 1)}>
            {p.sample ? p.emoji : i + 1}
          </button>
        ))}
      </div>

      <div className="editor-title">
        <details className="emoji-pick">
          <summary aria-label={t('emoji')}>{pad.emoji}</summary>
          <div className="emoji-grid">
            {EMOJIS.map((e) => (
              <button key={e} onClick={() => patch({ emoji: e })}>
                {e}
              </button>
            ))}
          </div>
        </details>
        <label className="field grow">
          <span>{t('padTitle', { pad: index + 1 })}</span>
          <input className="input" value={pad.name} maxLength={40} onChange={(e) => patch({ name: e.target.value })} placeholder={t('name')} />
        </label>
      </div>

      <section className="section">
        <h3>{t('sound')}</h3>
        <select
          className="input"
          value={pad.sample ?? ''}
          onChange={(e) => {
            const ref = e.target.value || null;
            const builtin = ref ? findBuiltin(ref) : undefined;
            const meta = ref ? library.meta(ref) : undefined;
            patch({
              sample: ref,
              name: builtin?.name ?? meta?.name ?? pad.name,
              emoji: builtin?.emoji ?? (meta ? '🎵' : pad.emoji),
              trimStart: 0,
              trimEnd: 0,
              reverse: false,
            });
          }}
          data-testid="sound-select"
        >
          <option value="">{t('noSound')}</option>
          {userSamples.length > 0 && (
            <optgroup label={t('mySounds')}>
              {userSamples.map((s) => (
                <option key={s.id} value={s.ref}>
                  🎵 {s.name} ({s.duration.toFixed(1)} s)
                </option>
              ))}
            </optgroup>
          )}
          {BUILTIN_BANKS.map((b) => (
            <optgroup key={b.id} label={`${t('builtinSounds')} · ${b.name}`}>
              {b.sounds.map((s) => (
                <option key={s.id} value={builtinRef(b.id, s.id)}>
                  {s.emoji} {s.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <div className="row">
          <button className="btn btn-primary" disabled={!pad.sample} onClick={() => performer.previewPad(bank.id, index)}>
            <Play size={15} /> {t('preview')}
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> {t('replaceSound')}
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.webm,.opus"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void importToPad(file, bank.id, index);
            }}
          />
        </div>
        {buffer && (
          <Waveform
            sampleRef={pad.sample!}
            duration={duration}
            trimStart={pad.trimStart}
            trimEnd={pad.trimEnd}
            reverse={pad.reverse}
            onTrim={(s, e) => patch({ trimStart: s, trimEnd: e })}
          />
        )}
        {buffer && (
          <div className="grid-2">
            <Range label={t('trimStart')} min={0} max={duration} step={0.005} value={pad.trimStart} unit="s" onChange={(v) => patch({ trimStart: Math.min(v, (pad.trimEnd || duration) - 0.01) })} />
            <Range label={t('trimEnd')} min={0} max={duration} step={0.005} value={pad.trimEnd || duration} unit="s" onChange={(v) => patch({ trimEnd: v >= duration - 0.002 ? 0 : Math.max(v, pad.trimStart + 0.01) })} />
          </div>
        )}
      </section>

      <section className="section">
        <h3>{t('gesture')}</h3>
        {learnPad === index ? (
          <div className="learn-box" data-testid="learning">
            <Hand className="learn-icon" size={22} />
            <span>{t('learning')}</span>
            <button className="btn btn-sm" onClick={() => useSession.getState().setLearnPad(null)}>
              {t('learnCancel')}
            </button>
          </div>
        ) : (
          <>
            <div className="row">
              {triggers.length === 0 && <span className="muted">{t('noGesture')}</span>}
              {triggers.map((tr, i) => (
                <span key={i} className="gesture-chip">
                  {tr.kind === 'gesture' ? GESTURE_EMOJI[tr.gesture] : MOTION_EMOJI[tr.motion]} {tr.kind === 'gesture' ? t(`g_${tr.gesture}` as DictKey) : t(`m_${tr.motion}` as DictKey)} · {handName(tr.hand)}
                </span>
              ))}
            </div>
            <div className="row">
              <button className="btn btn-green" onClick={() => useSession.getState().setLearnPad(index)} data-testid="learn-gesture">
                <Hand size={15} /> {t('learnGesture')}
              </button>
              {triggers.length > 0 && (
                <button className="btn btn-ghost" onClick={() => useProject.getState().removePadGestures(project.mode, index)}>
                  {t('removeGesture')}
                </button>
              )}
            </div>
          </>
        )}
      </section>

      <section className="section">
        <h3>{t('playMode')}</h3>
        <div className="segmented wrap">
          {PAD_MODES.map((m) => (
            <button key={m} aria-pressed={pad.mode === m} onClick={() => patch({ mode: m })}>
              {t(`pm_${m}` as DictKey)}
            </button>
          ))}
        </div>
        <Range label={t('volume')} min={0} max={1.5} step={0.01} value={pad.volume} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch({ volume: v })} />
        <Range label={t('pitch')} min={-12} max={12} step={1} value={pad.pitch} format={(v) => `${v > 0 ? '+' : ''}${v} ${t('semitones')}`} onChange={(v) => patch({ pitch: v })} />
        <Range label={t('pan')} min={-1} max={1} step={0.05} value={pad.pan} format={(v) => (Math.abs(v) < 0.03 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)} onChange={(v) => patch({ pan: Math.abs(v) < 0.03 ? 0 : v })} />
        <div className="grid-2">
          <Range label={t('fadeIn')} min={0} max={2} step={0.01} value={pad.fadeIn} unit="s" onChange={(v) => patch({ fadeIn: v })} />
          <Range label={t('fadeOut')} min={0} max={2} step={0.01} value={pad.fadeOut} unit="s" onChange={(v) => patch({ fadeOut: v })} />
        </div>
        <label className="toggle">
          <span>{t('reverse')}</span>
          <input type="checkbox" checked={pad.reverse} onChange={(e) => patch({ reverse: e.target.checked })} />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>{t('choke')}</span>
            <select className="input" value={pad.choke} onChange={(e) => patch({ choke: Number(e.target.value) })}>
              <option value={0}>{t('chokeNone')}</option>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('poly')}</span>
            <select className="input" value={pad.poly} onChange={(e) => patch({ poly: Number(e.target.value) })}>
              {[1, 2, 3, 4, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="field">
          <span>{t('key')}</span>
          <button
            className={`btn key-capture ${capturing ? 'capturing' : ''}`}
            data-capture-keys={capturing ? '' : undefined}
            onClick={() => setCapturing(true)}
            onBlur={() => setCapturing(false)}
            onKeyDown={(e) => {
              if (!capturing) return;
              e.preventDefault();
              e.stopPropagation();
              if (e.code !== 'Escape' && e.code !== 'Tab') patch({ key: e.code });
              setCapturing(false);
            }}
          >
            {capturing ? t('pressKey') : (keyLabels[padKeyCode(pad, index)] ?? padKeyCode(pad, index).replace(/^(Key|Digit)/, ''))}
          </button>
        </div>
      </section>

      <div className="row editor-actions">
        {BUILTIN_BANKS.some((b) => b.id === bank.id) && (
          <button className="btn" onClick={() => useProject.getState().resetPad(bank.id, index)}>
            <RotateCcw size={15} /> {t('resetPad')}
          </button>
        )}
        <button className="btn btn-danger" onClick={() => useProject.getState().clearPad(bank.id, index)}>
          <Trash2 size={15} /> {t('clearPad')}
        </button>
      </div>
    </div>
  );
}

function Range({
  label,
  min,
  max,
  step,
  value,
  unit,
  format,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="range-row">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="value">{format ? format(value) : `${value.toFixed(step < 0.1 ? 2 : 0)}${unit ? ` ${unit}` : ''}`}</span>
      </div>
    </label>
  );
}
