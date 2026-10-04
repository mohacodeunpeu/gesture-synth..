import { audioEngine } from '../audio/AudioEngine';
import { Sampler } from '../audio/Sampler';
import { sampleLibrary } from '../audio/SampleLibrary';
import { GestureEngine } from '../vision/GestureEngine';
import { HandTracker } from '../vision/HandTracker';
import { Performance } from './Performance';

/** App-wide engine singletons (browser only). React components read them, never own them. */
export const audio = audioEngine;
export const library = sampleLibrary;
export const sampler = new Sampler(audio, library);
export const tracker = new HandTracker();
export const gestures = new GestureEngine();
export const performer = new Performance(audio, library, sampler, tracker, gestures);

// Debug handle for diagnostics and end-to-end tests: open the app with ?debug to use it.
if (typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(location.search).has('debug'))) {
  (window as unknown as Record<string, unknown>).__moha = { audio, library, sampler, tracker, gestures, performer };
}
