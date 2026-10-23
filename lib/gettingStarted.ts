/**
 * The "Get started" checklist on the home page. Steps are remembered in this browser only:
 * each one is ticked where it actually happens (pre-join, LiveDoc, captions, replay), so the
 * list never claims something the user has not done.
 */

export const GETTING_STARTED_STEPS = ['devices', 'firstMeeting', 'liveDoc', 'captions', 'replay'] as const;
export type GettingStartedStep = (typeof GETTING_STARTED_STEPS)[number];

const DONE_KEY = 'km-getting-started';
const HIDDEN_KEY = 'km-getting-started-hidden';

export function readGettingStarted(): Set<GettingStartedStep> {
  try {
    const raw = JSON.parse(localStorage.getItem(DONE_KEY) || '[]');
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.filter((s): s is GettingStartedStep => GETTING_STARTED_STEPS.includes(s)));
  } catch {
    return new Set();
  }
}

export function markGettingStarted(step: GettingStartedStep): void {
  try {
    const done = readGettingStarted();
    if (done.has(step)) return;
    done.add(step);
    localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
  } catch {
    /* storage unavailable: the checklist just stays as it was */
  }
}

export function isGettingStartedHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function hideGettingStarted(): void {
  try {
    localStorage.setItem(HIDDEN_KEY, '1');
  } catch {
    /* ignore */
  }
}
