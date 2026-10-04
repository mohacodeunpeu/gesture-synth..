import { useEffect, useRef, useState } from 'react';
import { allBuiltinRefs } from '../../audio/sfx/index';
import { startCamera } from '../../app/boot';
import { audio, gestures, library, sampler, tracker } from '../../engine/instance';
import { Meter } from '../../components/Meter';
import { useAudioInfo, useTrackerInfo } from '../../hooks/useEngines';
import { useRaf } from '../../hooks/useRaf';
import { useT } from '../../hooks/useT';
import { useSession } from '../../store/sessionStore';
import { GESTURE_EMOJI } from '../../vision/gestureTypes';
import type { DictKey } from '../../i18n';

const fmtMs = (s: number | null) => (s === null ? '—' : `${(s * 1000).toFixed(1)} ms`);

export function DiagnosticsPanel() {
  const t = useT();
  const a = useAudioInfo();
  const c = useTrackerInfo();
  const persistenceOk = useSession((s) => s.persistenceOk);
  const [tick, setTick] = useState(0);
  const [fps, setFps] = useState(0);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const uiFps = useRef({ frames: 0, last: 0, fps: 0 });

  useRaf((now) => {
    const f = uiFps.current;
    f.frames++;
    if (!f.last) f.last = now;
    if (now - f.last >= 1000) {
      f.fps = Math.round((f.frames * 1000) / (now - f.last));
      f.frames = 0;
      f.last = now;
    }
  });

  useEffect(() => {
    const id = setInterval(() => {
      setTick((n) => n + 1);
      setFps(uiFps.current.fps);
    }, 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!a.canSelectOutput || !navigator.mediaDevices?.enumerateDevices) return;
    let alive = true;
    void navigator.mediaDevices.enumerateDevices().then((d) => alive && setOutputs(d.filter((x) => x.kind === 'audiooutput')));
    return () => {
      alive = false;
    };
  }, [a.canSelectOutput, c.camera]);

  const stats = tracker.stats;
  const loaded = allBuiltinRefs().filter((r) => library.has(r)).length + library.listUserSamples().filter((s) => library.has(s.ref)).length;
  const handLine = (side: 'Left' | 'Right') => {
    const h = gestures.hands[side];
    if (!h.present) return '—';
    const raw = h.raw === 'NONE' ? '·' : GESTURE_EMOJI[h.raw];
    const stable = h.stable === 'NONE' ? '' : ` → ${GESTURE_EMOJI[h.stable]} ${t(`g_${h.stable}` as DictKey)}`;
    return `${raw} ${(h.confidence * 100).toFixed(0)}%${stable}`;
  };

  return (
    <div data-tick={tick} style={{ display: 'contents' }}>
      <section className="section" data-testid="diag-audio">
        <h3>{t('diag_audio')}</h3>
        <dl className="kv">
          <dt>{t('diag_state')}</dt>
          <dd className={a.status === 'running' ? 'good' : 'bad'} data-testid="diag-audio-state">
            {a.status}
          </dd>
          <dt>{t('diag_sampleRate')}</dt>
          <dd>{a.sampleRate ? `${a.sampleRate} Hz` : '—'}</dd>
          <dt>{t('diag_latency')}</dt>
          <dd>
            {fmtMs(a.baseLatency)} / {fmtMs(a.outputLatency)}
          </dd>
          <dt>{t('diag_worklets')}</dt>
          <dd className={a.worklets === 'ready' ? 'good' : a.worklets === 'failed' ? 'warn' : ''}>{a.worklets}</dd>
          <dt>{t('diag_volume')}</dt>
          <dd className={a.muted || a.volume < 0.05 ? 'bad' : ''}>{a.muted ? t('muted') : `${Math.round(a.volume * 100)}%`}</dd>
          <dt>{t('diag_samples')}</dt>
          <dd>{loaded}</dd>
          <dt>{t('diag_voices')}</dt>
          <dd>{sampler.activeCount}</dd>
          <dt>{t('diag_master')}</dt>
          <dd>
            <Meter className="meter" />
          </dd>
        </dl>
        {outputs.length > 0 && (
          <label className="field">
            <span>{t('diag_output')}</span>
            <select className="input" value={a.sinkId} onChange={(e) => void audio.setOutputDevice(e.target.value).catch((err) => console.warn(err))}>
              {outputs.map((o, i) => (
                <option key={o.deviceId || i} value={o.deviceId === 'default' ? '' : o.deviceId}>
                  {o.label || `Output ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="row">
          <button
            className="btn btn-primary"
            data-testid="diag-test-audio"
            onClick={() => {
              if (!audio.isRunning) audio.unlock();
              audio.playTest();
            }}
          >
            {t('testAudio')}
          </button>
          <button className="btn" onClick={() => void audio.resume()}>
            {t('resumeAudio')}
          </button>
          <button className="btn btn-danger" onClick={() => audio.reset()}>
            {t('resetAudio')}
          </button>
        </div>
      </section>

      <section className="section" data-testid="diag-camera">
        <h3>{t('diag_camera')}</h3>
        <dl className="kv">
          <dt>{t('diag_permission')}</dt>
          <dd className={c.camera === 'live' ? 'good' : 'bad'} data-testid="diag-camera-state">
            {c.camera}
          </dd>
          <dt>{t('diag_device')}</dt>
          <dd>{c.deviceLabel || '—'}</dd>
          <dt>{t('diag_resolution')}</dt>
          <dd>{c.width ? `${c.width}×${c.height}` : '—'}</dd>
          <dt>{t('diag_cameraFps')}</dt>
          <dd>{stats.cameraFps}</dd>
          <dt>{t('diag_trackingFps')}</dt>
          <dd>
            {stats.trackingFps} ({stats.targetFps})
          </dd>
          <dt>{t('diag_inference')}</dt>
          <dd>{stats.inferenceMs ? `${stats.inferenceMs.toFixed(1)} ms` : '—'}</dd>
          <dt>{t('diag_delegate')}</dt>
          <dd>{c.delegate ?? '—'}</dd>
          <dt>{t('diag_model')}</dt>
          <dd className={c.model === 'ready' ? 'good' : c.model === 'error' ? 'bad' : ''} data-testid="diag-model-state">
            {c.model}
            {c.modelSource ? ` (${c.modelSource})` : ''}
          </dd>
          <dt>{t('diag_hands')}</dt>
          <dd data-testid="diag-hands">{stats.hands}</dd>
          <dt>{t('diag_dropped')}</dt>
          <dd>{stats.droppedFrames}</dd>
          <dt>
            {t('diag_gesture')} {t('rightShort')}
          </dt>
          <dd data-testid="diag-gesture-right">{handLine('Right')}</dd>
          <dt>
            {t('diag_gesture')} {t('leftShort')}
          </dt>
          <dd data-testid="diag-gesture-left">{handLine('Left')}</dd>
        </dl>
        {c.cameraError && <p className="muted mono">{c.cameraError}</p>}
        {c.modelError && <p className="muted mono">{c.modelError}</p>}
        <div className="row">
          <button className="btn btn-primary" onClick={() => void startCamera()}>
            {t('testCamera')}
          </button>
          <button
            className="btn"
            onClick={() => {
              tracker.stopCamera();
              void startCamera();
            }}
          >
            {t('resetCamera')}
          </button>
          <button className="btn btn-danger" onClick={() => tracker.stopCamera()}>
            {t('stopCamera')}
          </button>
        </div>
      </section>

      <section className="section">
        <h3>{t('diag_perf')}</h3>
        <dl className="kv">
          <dt>{t('diag_uiFps')}</dt>
          <dd>{fps}</dd>
          <dt>{t('diag_storage')}</dt>
          <dd className={persistenceOk ? 'good' : 'bad'}>{persistenceOk ? t('ok') : t('unavailable')}</dd>
          <dt>Version</dt>
          <dd>{__APP_VERSION__}</dd>
        </dl>
      </section>
    </div>
  );
}
