import { useEffect } from 'react';
import { performer } from '../engine/instance';
import { padKeyCode } from '../engine/projectTypes';
import { keyLabelsFor } from '../app/boot';
import { activeBank, useProject } from '../store/projectStore';
import { useSession } from '../store/sessionStore';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable || !!el.closest?.('[data-capture-keys]');
}

/** Global keyboard → pads (1234 / QWER / ASDF / ZXCV by physical position), Esc, arrows. */
export function useKeyboardPads(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const down = new Set<string>();

    const padIndexFor = (code: string): number => {
      const bank = activeBank(useProject.getState().project);
      return bank.pads.findIndex((p, i) => padKeyCode(p, i) === code);
    };

    const onDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      // learn the real layout from what the user types (AZERTY detection without the Keyboard API)
      if (e.code === 'KeyQ' && e.key.toLowerCase() === 'a') useSession.getState().setKeyLabels(keyLabelsFor('azerty'));
      if (e.code === 'KeyQ' && e.key.toLowerCase() === 'q' && useSession.getState().keyLabels.KeyQ === 'A') useSession.getState().setKeyLabels(keyLabelsFor('qwerty'));

      if (e.code === 'Escape') {
        performer.stopAll();
        useSession.getState().closeDrawer();
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        e.preventDefault();
        performer.cycleBank(e.code === 'ArrowRight' ? 1 : -1);
        return;
      }
      const index = padIndexFor(e.code);
      if (index < 0) return;
      e.preventDefault();
      if (e.repeat || down.has(e.code)) return;
      down.add(e.code);
      performer.triggerPad(index, 'key');
    };

    const onUp = (e: KeyboardEvent) => {
      if (!down.delete(e.code)) return;
      const index = padIndexFor(e.code);
      if (index >= 0) performer.releasePad(index);
    };

    const onBlur = () => {
      for (const code of down) {
        const index = padIndexFor(code);
        if (index >= 0) performer.releasePad(index);
      }
      down.clear();
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [enabled]);
}
