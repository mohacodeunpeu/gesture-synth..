import { X } from 'lucide-react';
import { useT } from '../../hooks/useT';
import { useSession, type DrawerTab } from '../../store/sessionStore';
import { PadEditor } from '../sampler/PadEditor';
import { SettingsPanel } from '../settings/SettingsPanel';
import { DiagnosticsPanel } from '../diagnostics/DiagnosticsPanel';
import './drawer.css';

const TABS: DrawerTab[] = ['pad', 'settings', 'diagnostics'];

export function Drawer() {
  const t = useT();
  const tab = useSession((s) => s.drawer);
  const open = useSession((s) => s.openDrawer);
  const close = useSession((s) => s.closeDrawer);
  if (!tab) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={close} />
      <aside className="drawer" role="dialog" aria-modal="false" aria-label={t(`tab_${tab}`)} data-testid="drawer">
        <header className="drawer-head">
          <div className="segmented" role="tablist">
            {TABS.map((id) => (
              <button key={id} role="tab" aria-pressed={tab === id} aria-selected={tab === id} onClick={() => open(id)} data-testid={`tab-${id}`}>
                {t(`tab_${id}`)}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost btn-icon" aria-label={t('close')} onClick={close} data-testid="drawer-close">
            <X size={18} />
          </button>
        </header>
        <div className="drawer-body">
          {tab === 'pad' && <PadEditor />}
          {tab === 'settings' && <SettingsPanel />}
          {tab === 'diagnostics' && <DiagnosticsPanel />}
        </div>
      </aside>
    </>
  );
}
