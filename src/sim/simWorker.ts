/// <reference lib="webworker" />
import { fireSession, type FireSessionInput } from './fireSession';

/** Runs a Fire's simulation off the main thread (#333). One request at a time, answered with its id. */
self.onmessage = (event: MessageEvent<{ id: number; input: FireSessionInput }>) => {
  const { id, input } = event.data;
  try {
    (self as unknown as Worker).postMessage({ id, timeline: fireSession(input) });
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, error: String(error) });
  }
};
