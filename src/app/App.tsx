import { useEffect } from 'react';
import { useSession } from '../store/sessionStore';
import { StartScreen } from '../features/start/StartScreen';
import { MainScreen } from './MainScreen';
import { boot } from './boot';
import { Toasts } from '../components/Toasts';

export function App() {
  const phase = useSession((s) => s.phase);
  useEffect(() => {
    void boot();
  }, []);
  return (
    <>
      {phase === 'app' ? <MainScreen /> : <StartScreen booting={phase === 'boot'} />}
      <Toasts />
    </>
  );
}
