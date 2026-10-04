import { useSyncExternalStore } from 'react';
import { Lock } from 'lucide-react';
import { AudioEngine } from '../../audio/AudioEngine';
import { allBuiltinRefs } from '../../audio/sfx/index';
import { startApp } from '../../app/boot';
import { library } from '../../engine/instance';
import { useLibraryVersion, useTrackerInfo } from '../../hooks/useEngines';
import { useT } from '../../hooks/useT';
import { LangSwitch } from '../../components/LangSwitch';
import './start.css';

const TOTAL = allBuiltinRefs().length;

function useBuiltinReady(): number {
  useLibraryVersion();
  return useSyncExternalStore(library.subscribe, () => allBuiltinRefs().filter((r) => library.has(r)).length);
}

export function StartScreen({ booting }: { booting: boolean }) {
  const t = useT();
  const tracker = useTrackerInfo();
  const soundsReady = useBuiltinReady();
  const supported = AudioEngine.isSupported();
  const modelPct = tracker.model === 'ready' ? 100 : Math.round(tracker.modelProgress * 100);

  return (
    <main className="start">
      <div className="start-glow" aria-hidden />
      <header className="start-top">
        <LangSwitch />
      </header>
      <section className="start-center">
        <div className="start-hands" aria-hidden>
          <span className="wave-l">🤘</span>
          <span className="wave-r">✌️</span>
        </div>
        <h1 className="logo">
          <span className="logo-a">MOHA</span>
          <span className="logo-b">MOTION</span>
        </h1>
        <p className="tagline">{t('appTagline')}</p>
        {supported ? (
          <button className="start-btn" data-testid="start" onClick={startApp} disabled={booting} autoFocus>
            <span className="start-ring" aria-hidden />
            <span className="start-label">{booting ? t('boot') : t('start')}</span>
          </button>
        ) : (
          <p className="start-error">{t('audioUnsupported')}</p>
        )}
        <p className="start-hint">{t('startHint')}</p>
        <div className="start-progress" aria-live="polite">
          <Progress label={t('handModel')} value={modelPct} done={tracker.model === 'ready'} failed={tracker.model === 'error'} />
          <Progress label={t('sounds')} value={(soundsReady / TOTAL) * 100} done={soundsReady === TOTAL} text={`${soundsReady}/${TOTAL}`} />
        </div>
      </section>
      <footer className="start-privacy">
        <Lock size={14} aria-hidden />
        <span>{t('privacy')}</span>
      </footer>
    </main>
  );
}

function Progress({ label, value, done, failed, text }: { label: string; value: number; done: boolean; failed?: boolean; text?: string }) {
  return (
    <div className={`progress ${done ? 'done' : ''} ${failed ? 'failed' : ''}`}>
      <span className="progress-label">{label}</span>
      <span className="progress-bar">
        <span style={{ width: `${failed ? 100 : Math.max(3, value)}%` }} />
      </span>
      <span className="progress-val mono">{failed ? '⚠' : done ? '✓' : (text ?? `${Math.round(value)}%`)}</span>
    </div>
  );
}
