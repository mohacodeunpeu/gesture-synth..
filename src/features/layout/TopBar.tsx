import { useState } from 'react';
import { ChevronLeft, ChevronRight, Settings2, Stethoscope } from 'lucide-react';
import { audio, gestures, performer } from '../../engine/instance';
import { MODE_EMOJI, type ModeId } from '../../engine/mappingTypes';
import { useAudioInfo, useTrackerInfo } from '../../hooks/useEngines';
import { useRaf } from '../../hooks/useRaf';
import { useT } from '../../hooks/useT';
import { activeBank, useProject } from '../../store/projectStore';
import { useSession } from '../../store/sessionStore';
import { useSettings } from '../../store/settingsStore';
import type { DictKey } from '../../i18n';
import './layout.css';

/** Modes available in this version (synth + FX arrive with their engines). */
const VISIBLE_MODES: ModeId[] = ['memes', 'drums', 'custom'];

export function TopBar() {
  const t = useT();
  const project = useProject((s) => s.project);
  const setMode = useProject((s) => s.setMode);
  const setBank = useProject((s) => s.setBank);
  const openDrawer = useSession((s) => s.openDrawer);
  const bank = activeBank(project);

  return (
    <header className="topbar">
      <div className="brand" aria-label="MOHA MOTION">
        <span className="brand-a">MOHA</span>
        <span className="brand-b">MOTION</span>
      </div>

      <nav className="modes" aria-label="Mode">
        {VISIBLE_MODES.map((m) => (
          <button key={m} className="mode-btn" aria-pressed={project.mode === m} onClick={() => setMode(m)} data-testid={`mode-${m}`}>
            <span aria-hidden>{MODE_EMOJI[m]}</span>
            <span className="mode-label">{t(`mode_${m}` as DictKey)}</span>
          </button>
        ))}
      </nav>

      <div className="bank-switch">
        <button className="btn btn-ghost btn-icon" aria-label="previous bank" onClick={() => performer.cycleBank(-1)}>
          <ChevronLeft size={18} />
        </button>
        <label className="bank-select">
          <span className="sr-only">{t('bank')}</span>
          <select value={bank.id} onChange={(e) => setBank(e.target.value)} data-testid="bank-select">
            {project.banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.emoji} {b.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-ghost btn-icon" aria-label="next bank" onClick={() => performer.cycleBank(1)}>
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="status">
        <AudioPill />
        <CameraPill />
      </div>

      <div className="top-actions">
        <button className="btn btn-ghost btn-icon" aria-label={t('tab_settings')} title={t('tab_settings')} onClick={() => openDrawer('settings')}>
          <Settings2 size={18} />
        </button>
        <button className="btn btn-ghost btn-icon" aria-label={t('tab_diagnostics')} title={t('tab_diagnostics')} onClick={() => openDrawer('diagnostics')} data-testid="open-diagnostics">
          <Stethoscope size={18} />
        </button>
      </div>
    </header>
  );
}

function AudioPill() {
  const t = useT();
  const info = useAudioInfo();
  let cls = 'bad';
  let label = t('audioLocked');
  if (info.status === 'running') {
    cls = info.muted ? 'warn' : 'ok';
    label = info.muted ? t('muted') : t('audioOk');
  } else if (info.status === 'suspended' || info.status === 'interrupted') {
    cls = 'warn';
    label = t('audioPaused');
  } else if (info.status === 'unsupported') label = t('audioUnsupportedShort');
  return (
    <button
      className={`pill ${cls}`}
      data-testid="audio-pill"
      data-status={info.status}
      onClick={() => {
        if (info.status !== 'running') audio.unlock();
        else useSession.getState().openDrawer('diagnostics');
      }}
    >
      <span className="dot" />
      {label}
    </button>
  );
}

function CameraPill() {
  const t = useT();
  const info = useTrackerInfo();
  const [hands, setHands] = useState(0);
  useRaf(() => {
    const n = Number(gestures.hands.Left.present) + Number(gestures.hands.Right.present);
    if (n !== hands) setHands(n);
  });
  const live = info.camera === 'live';
  const cls = live ? (hands > 0 ? 'ok' : 'warn') : info.camera === 'requesting' || info.camera === 'off' ? 'warn' : 'bad';
  const swap = useSettings((s) => s.swapHands);
  const label = live ? (hands === 0 ? t('handsNone') : hands === 1 ? t('handsOne') : t('handsTwo')) : t(`cam_${info.camera}` as DictKey);
  return (
    <button className={`pill ${cls}`} data-testid="camera-pill" data-status={info.camera} data-hands={hands} data-swap={swap} onClick={() => useSession.getState().openDrawer('diagnostics')}>
      <span className="dot" />
      {label}
    </button>
  );
}
