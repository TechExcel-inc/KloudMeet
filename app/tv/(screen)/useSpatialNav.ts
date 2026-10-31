'use client';

import { pickNext, type NavDirection } from '@/lib/tv/spatialNav';

/**
 * D-pad focus on the real page (geometry in lib/tv/spatialNav.ts).
 *
 * Where focus may go: inside the top-most `[data-tv-modal]` when one is open, otherwise the
 * whole page except the meeting's video / document stage, iframes and anything hidden.
 * `[data-tv-autofocus]` marks where focus lands when nothing is focused yet.
 */

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"]), [data-tv-focusable]';
const SKIP = '[data-tv-skip], .main-meeting-area, [hidden], [aria-hidden="true"], [inert]';

function isVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) return false;
  // Not opacity: dialogs fade in from 0, and must take focus on their first frame
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

export function navRoot(): HTMLElement {
  const modals = Array.from(document.querySelectorAll<HTMLElement>('[data-tv-modal]')).filter(isVisible);
  return modals[modals.length - 1] ?? document.body;
}

export function navCandidates(root: HTMLElement = navRoot()): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest(SKIP) && el.tagName !== 'IFRAME' && isVisible(el),
  );
}

/**
 * Bring `el` into view inside its scrolling list (People, Settings). Not scrollIntoView: that
 * also scrolls overflow:hidden boxes, and would slide the whole TV canvas to reach a button of
 * the control bar while the bar is tucked away below the screen.
 */
function revealInList(el: HTMLElement): void {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy !== 'auto' && oy !== 'scroll') || p.scrollHeight <= p.clientHeight) continue;
    const box = p.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const scale = box.height / p.clientHeight || 1;
    if (r.top < box.top) p.scrollTop -= (box.top - r.top) / scale + 8;
    else if (r.bottom > box.bottom) p.scrollTop += (r.bottom - box.bottom) / scale + 8;
    return;
  }
}

function focusEl(el: HTMLElement): void {
  el.focus({ preventScroll: true });
  // Focus events don't fire while the window is in the background; keep the mirror right
  document.querySelectorAll('[data-tv-focus]').forEach((x) => x !== el && x.removeAttribute('data-tv-focus'));
  el.setAttribute('data-tv-focus', '');
  revealInList(el);
}

/** Focus `el` if D-pad navigation could reach it right now. */
export function focusElement(el: HTMLElement): boolean {
  if (!navCandidates().includes(el)) return false;
  focusEl(el);
  return true;
}

/** Focus the screen's default element (or its first focusable). */
export function focusDefault(root: HTMLElement = navRoot()): boolean {
  const list = navCandidates(root);
  const preferred = list.find((el) => el.hasAttribute('data-tv-autofocus')) ?? list[0];
  if (!preferred) return false;
  focusEl(preferred);
  return true;
}

/** Is focus on something D-pad navigation can move from? */
export function focusInRoot(root: HTMLElement = navRoot()): boolean {
  const active = document.activeElement as HTMLElement | null;
  return Boolean(active && active !== document.body && root.contains(active) && navCandidates(root).includes(active));
}

export function moveFocus(dir: NavDirection): boolean {
  const root = navRoot();
  const active = document.activeElement as HTMLElement | null;
  const list = navCandidates(root);
  if (!active || !list.includes(active)) return focusDefault(root);
  const from = active.getBoundingClientRect();
  const others = list.filter((el) => el !== active);
  const next = pickNext(from, others.map((el) => el.getBoundingClientRect()), dir);
  if (next < 0) return false;
  focusEl(others[next]);
  return true;
}

/** OK on the remote: activate whatever is focused. */
export function pressFocused(): boolean {
  const root = navRoot();
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body || !root.contains(active)) return focusDefault(root);
  active.click();
  return true;
}
