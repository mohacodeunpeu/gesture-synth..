import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { startCamera } from '../../app/boot';
import { tracker } from '../../engine/instance';
import { LangSwitch } from '../../components/LangSwitch';
import { useTrackerInfo } from '../../hooks/useEngines';
import { useT } from '../../hooks/useT';
import { useProject } from '../../store/projectStore';
import { useSettings } from '../../store/settingsStore';

export function SettingsPanel() {
  const t = useT();
  const s = useSettings();
  const info = useTrackerInfo();
  const mode = useProject((p) => p.project.mode);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let alive = true;
    void tracker.listCameras().then((list) => alive && setCameras(list));
    return () => {
      alive = false;
    };
  }, [info.camera]);

  const switchCamera = (cameraId: string | null, facing = s.facing) => {
    s.set({ cameraId, facing });
    void startCamera();
  };

  return (
    <>
      <section className="section">
        <h3>{t('language')}</h3>
        <LangSwitch />
      </section>

      <section className="section">
        <h3>{t('camera')}</h3>
        <select className="input" value={s.cameraId ?? ''} onChange={(e) => switchCamera(e.target.value || null)}>
          <option value="">{t('defaultCamera')}</option>
          {cameras.map((c, i) => (
            <option key={c.deviceId || i} value={c.deviceId}>
              {c.label || `${t('camera')} ${i + 1}`}
            </option>
          ))}
        </select>
        {cameras.length > 1 && (
          <div className="segmented">
            <button aria-pressed={s.facing === 'user' && !s.cameraId} onClick={() => switchCamera(null, 'user')}>
              {t('frontCamera')}
            </button>
            <button aria-pressed={s.facing === 'environment' && !s.cameraId} onClick={() => switchCamera(null, 'environment')}>
              {t('backCamera')}
            </button>
          </div>
        )}
        <Toggle label={t('mirror')} checked={s.mirror} onChange={(v) => s.set({ mirror: v })} />
        <Toggle label={t('swapHands')} checked={s.swapHands} onChange={(v) => s.set({ swapHands: v })} />
        <Toggle label={t('showSkeleton')} checked={s.showSkeleton} onChange={(v) => s.set({ showSkeleton: v })} />
        <Toggle label={t('showCheatSheet')} checked={s.showCheatSheet} onChange={(v) => s.set({ showCheatSheet: v })} />
      </section>

      <section className="section">
        <h3>{t('gesture')}</h3>
        <Slider label={t('sensitivity')} min={0} max={1} step={0.05} value={s.sensitivity} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => s.set({ sensitivity: v })} />
        <Slider label={t('dwell')} min={40} max={300} step={10} value={s.dwellMs} format={(v) => `${v} ${t('ms')}`} onChange={(v) => s.set({ dwellMs: v })} />
        <Slider label={t('cooldown')} min={80} max={800} step={20} value={s.cooldownMs} format={(v) => `${v} ${t('ms')}`} onChange={(v) => s.set({ cooldownMs: v })} />
        <button className="btn" onClick={() => useProject.getState().resetMappings(mode)}>
          <RotateCcw size={15} /> {t('resetMappings')}
        </button>
      </section>
    </>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Slider({ label, min, max, step, value, format, onChange }: { label: string; min: number; max: number; step: number; value: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="range-row">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="value">{format(value)}</span>
      </div>
    </label>
  );
}
