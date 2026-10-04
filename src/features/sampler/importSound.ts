import { SampleDecodeError, SampleLibrary } from '../../audio/SampleLibrary';
import { audio, library, performer } from '../../engine/instance';
import { activeBank, useProject } from '../../store/projectStore';
import { useSession } from '../../store/sessionStore';

/** Imports an audio file onto a pad: decode → store locally → assign → play once as confirmation. */
export async function importToPad(file: File, bankId: string, index: number): Promise<boolean> {
  const session = useSession.getState();
  if (!SampleLibrary.looksLikeAudio(file)) {
    session.toast('notAudio', 'error');
    return false;
  }
  try {
    const meta = await library.importFile(file);
    const trimStart = library.leadingSilence(meta.ref);
    useProject.getState().updatePad(bankId, index, {
      sample: meta.ref,
      name: meta.name,
      emoji: '🎵',
      image: null,
      trimStart,
      trimEnd: 0,
      reverse: false,
      pitch: 0,
      mode: 'oneshot',
    });
    session.toast('imported', 'success', { name: meta.name, pad: index + 1 });
    if (audio.isRunning) performer.previewPad(bankId, index);
    return true;
  } catch (err) {
    console.warn('[import] failed', err);
    session.toast(err instanceof SampleDecodeError && err.message === 'too-large' ? 'tooLarge' : 'decodeFailed', 'error');
    return false;
  }
}

/** "Import sound" button: first empty pad of the current bank, else of a custom bank. */
export async function importToFreePad(file: File): Promise<boolean> {
  const { project, setBank } = useProject.getState();
  const current = activeBank(project);
  let bank = current;
  let index = current.pads.findIndex((p) => !p.sample);
  if (index < 0) {
    for (const b of project.banks) {
      const i = b.pads.findIndex((p) => !p.sample);
      if (i >= 0) {
        bank = b;
        index = i;
        break;
      }
    }
  }
  if (index < 0) {
    // everything is full: replace the selected pad of the current bank
    bank = current;
    index = useSession.getState().selectedPad;
  }
  if (bank.id !== current.id) setBank(bank.id);
  useSession.getState().selectPad(index);
  return importToPad(file, bank.id, index);
}
