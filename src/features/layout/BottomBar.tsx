import { useRef } from 'react';
import { Pencil, Upload, Volume2 } from 'lucide-react';
import { audio } from '../../engine/instance';
import { useT } from '../../hooks/useT';
import { Meter } from '../../components/Meter';
import { importToFreePad } from '../sampler/importSound';
import { useSession } from '../../store/sessionStore';
import { DEFAULT_PAD_KEYS } from '../../engine/projectTypes';

export function BottomBar() {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const keyLabels = useSession((s) => s.keyLabels);
  const editMode = useSession((s) => s.editMode);
  const setEditMode = useSession((s) => s.setEditMode);
  const label = (code: string) => keyLabels[code] ?? code.replace(/^(Key|Digit)/, '');
  const rows = [0, 4, 8, 12].map((i) => `${label(DEFAULT_PAD_KEYS[i])}-${label(DEFAULT_PAD_KEYS[i + 3])}`).join(' · ');

  return (
    <footer className="bottombar">
      <button
        className="btn btn-primary"
        data-testid="test-audio"
        onClick={() => {
          if (!audio.isRunning) audio.unlock();
          audio.playTest();
        }}
      >
        <Volume2 size={17} />
        <span>{t('testAudio')}</span>
      </button>
      <Meter />
      <button className="btn" onClick={() => fileRef.current?.click()} data-testid="import-sound">
        <Upload size={16} />
        <span className="btn-label-wide">{t('importSound')}</span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.webm,.opus"
        hidden
        data-testid="import-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void importToFreePad(file);
        }}
      />
      <button className={`btn ${editMode ? 'btn-green' : ''}`} aria-pressed={editMode} onClick={() => setEditMode(!editMode)} data-testid="edit-mode">
        <Pencil size={16} />
        <span className="btn-label-wide">{t('editPads')}</span>
      </button>
      {editMode ? <span className="hint edit-hint">{t('editModeHint')}</span> : <span className="hint">{t('shortcutsHint', { rows })}</span>}
    </footer>
  );
}
