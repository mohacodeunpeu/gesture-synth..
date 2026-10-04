import { findBuiltin } from './index';

/** Generates built-in sounds off the main thread so the UI never stutters at startup. */
interface Job {
  id: number;
  ref: string;
  sampleRate: number;
}

interface WorkerScope {
  onmessage: ((e: MessageEvent<Job>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const { id, ref, sampleRate } = e.data;
  try {
    const sound = findBuiltin(ref);
    if (!sound) throw new Error(`unknown sound ${ref}`);
    const channels = sound.generate(sampleRate);
    scope.postMessage({ id, ref, channels }, channels.map((c) => c.buffer));
  } catch (err) {
    scope.postMessage({ id, ref, error: err instanceof Error ? err.message : String(err) });
  }
};
