import { useSyncExternalStore } from 'react';
import { audio, library, tracker } from '../engine/instance';
import type { AudioInfo } from '../audio/AudioEngine';
import type { TrackerInfo } from '../vision/HandTracker';

export function useAudioInfo(): AudioInfo {
  return useSyncExternalStore(audio.subscribe, () => audio.getInfo());
}

export function useTrackerInfo(): TrackerInfo {
  return useSyncExternalStore(tracker.subscribe, tracker.getInfo);
}

/** Re-renders when samples are added, generated or removed. */
export function useLibraryVersion(): number {
  return useSyncExternalStore(library.subscribe, library.getVersion);
}
