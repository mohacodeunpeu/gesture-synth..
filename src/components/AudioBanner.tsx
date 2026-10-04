import { audio } from '../engine/instance';
import { useAudioInfo } from '../hooks/useEngines';
import { useT } from '../hooks/useT';

/** Impossible to miss: shown whenever the browser paused audio, or the master is muted. */
export function AudioBanner() {
  const t = useT();
  const info = useAudioInfo();
  const paused = info.unlocked && (info.status === 'suspended' || info.status === 'interrupted' || info.status === 'closed');
  if (paused) {
    return (
      <button className="audio-banner" data-testid="audio-banner" onClick={() => void audio.resume().catch(() => audio.reset())}>
        {t('audioPausedBanner')}
      </button>
    );
  }
  if (info.status === 'running' && info.muted) {
    return (
      <button className="audio-banner muted" onClick={() => audio.setMuted(false)}>
        {t('audioMutedBanner')}
      </button>
    );
  }
  return null;
}
