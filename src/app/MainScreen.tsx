import { useEffect } from 'react';
import { TopBar } from '../features/layout/TopBar';
import { BottomBar } from '../features/layout/BottomBar';
import { Stage } from '../features/stage/Stage';
import { PadGrid } from '../features/sampler/PadGrid';
import { Drawer } from '../features/drawer/Drawer';
import { AudioBanner } from '../components/AudioBanner';
import { useKeyboardPads } from '../hooks/useKeyboardPads';
import { performer } from '../engine/instance';
import { useSession } from '../store/sessionStore';
import { useProject } from '../store/projectStore';
import { GESTURE_EMOJI } from '../vision/gestureTypes';
import { translate } from '../i18n';
import { useSettings } from '../store/settingsStore';
import './main.css';

export function MainScreen() {
  const drawer = useSession((s) => s.drawer);
  useKeyboardPads(true);

  useEffect(() => {
    const offBank = performer.events.on('bankChanged', (e) => useSession.getState().toast('bankChanged', 'info', { name: `${e.emoji} ${e.name}` }));
    const offLearn = performer.events.on('learned', (e) => {
      const lang = useSettings.getState().lang;
      const bank = useProject.getState().project.banks.find((b) => b.id === useProject.getState().project.bankId);
      const pad = bank?.pads[e.pad];
      useSession.getState().toast('learned', 'success', {
        gesture: `${GESTURE_EMOJI[e.gesture]} ${translate(lang, `g_${e.gesture}`)}`,
        hand: translate(lang, e.hand === 'Left' ? 'left' : 'right'),
        name: pad?.name || translate(lang, 'pad', { n: e.pad + 1 }),
      });
    });
    return () => {
      offBank();
      offLearn();
    };
  }, []);

  return (
    <div className={`app ${drawer ? 'has-drawer' : ''}`}>
      <TopBar />
      <main className="workspace">
        <Stage />
        <PadGrid />
      </main>
      <BottomBar />
      <Drawer />
      <AudioBanner />
    </div>
  );
}
