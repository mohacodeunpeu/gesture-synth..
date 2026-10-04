import { useSettings } from '../store/settingsStore';

export function LangSwitch() {
  const lang = useSettings((s) => s.lang);
  const set = useSettings((s) => s.set);
  return (
    <div className="segmented" role="group" aria-label="Language">
      <button aria-pressed={lang === 'fr'} onClick={() => set({ lang: 'fr' })}>
        FR
      </button>
      <button aria-pressed={lang === 'en'} onClick={() => set({ lang: 'en' })}>
        EN
      </button>
    </div>
  );
}
