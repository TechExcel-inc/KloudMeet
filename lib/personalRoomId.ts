/**
 * Personal meeting ID rules and suggestions (client and server safe; no DB access).
 * Rule: 3–12 letters and digits, at least one letter, no dash. Case-insensitive.
 */
export const PERSONAL_ROOM_ID_RE = /^(?=.*[a-zA-Z])[a-zA-Z0-9]{3,12}$/;

export function isValidPersonalRoomId(id: string): boolean {
  return PERSONAL_ROOM_ID_RE.test(id.trim());
}

/** Keeps what the field may hold: letters and digits only, at most 12. */
export function cleanPersonalRoomIdInput(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
}

function slug(raw: string | null | undefined): string {
  return (raw ?? '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

/**
 * IDs to offer, best first: from a typed base (when it is taken) and from the
 * person's names. Only valid, distinct IDs; the caller filters out taken ones.
 */
export function personalRoomIdCandidates(
  names: { username?: string | null; fullName?: string | null; email?: string | null },
  base?: string,
  year = new Date().getFullYear(),
): string[] {
  const words = (names.fullName ?? '').split(/\s+/).map(slug).filter(Boolean);
  const first = words[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1] : '';
  const user = slug(names.username);
  const mail = slug(names.email?.split('@')[0]);
  const yy = String(year % 100).padStart(2, '0');

  const out: string[] = [];
  const add = (c: string) => {
    const id = c.slice(0, 12);
    if (isValidPersonalRoomId(id) && !out.includes(id)) out.push(id);
  };

  const typed = slug(base);
  if (typed) {
    add(typed);
    if (first && typed !== first) add(typed + first);
    if (last) add(typed + last);
    if (last) add(typed + last[0]);
    add(typed + yy);
    for (let n = 1; n <= 9; n++) add(typed + n);
  }
  for (const stem of [first, user, first + last, user + yy, mail]) add(stem);
  if (first && last) add(first + last[0]);
  for (const stem of [first || user || mail]) {
    if (!stem) continue;
    add(stem + yy);
    for (let n = 1; n <= 9; n++) add(stem + n);
  }
  return out;
}

/* ── Home prompt: "Not now" hides it for 14 days; the second "Not now" for good ── */

export const PERSONAL_ID_PROMPT_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

export type PersonalIdPromptState = { dismissals: number; hiddenUntil: number };

export function personalIdPromptKey(userId: string): string {
  return `km-personal-id-prompt:${userId}`;
}

export function parsePersonalIdPromptState(raw: string | null): PersonalIdPromptState {
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (v && typeof v.dismissals === 'number' && typeof v.hiddenUntil === 'number') return v;
  } catch {
    /* fall through */
  }
  return { dismissals: 0, hiddenUntil: 0 };
}

export function isPersonalIdPromptVisible(state: PersonalIdPromptState, now: number): boolean {
  return state.dismissals < 2 && now >= state.hiddenUntil;
}

export function snoozePersonalIdPrompt(state: PersonalIdPromptState, now: number): PersonalIdPromptState {
  return { dismissals: state.dismissals + 1, hiddenUntil: now + PERSONAL_ID_PROMPT_SNOOZE_MS };
}
