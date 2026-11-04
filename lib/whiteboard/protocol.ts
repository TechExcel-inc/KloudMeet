/**
 * Excalidraw board sync (LiveDoc whiteboard): message shapes and the pure rules every client
 * applies the same way. No Excalidraw import here, so it stays cheap to load and test.
 *
 * Reliable messages go over a LiveKit text stream on WB_TOPIC (any size, ordered per sender);
 * cursor and view updates go over lossy data packets on WB_LIVE_TOPIC.
 */

export const WB_TOPIC = 'wb';
export const WB_LIVE_TOPIC = 'wb-live';

/** The fields of an Excalidraw element this module reads; the rest travels untouched. */
export interface BoardElement {
  id: string;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  type: string;
  text?: string;
  [key: string]: unknown;
}

/** Scene-coordinate rectangle: [minX, minY, maxX, maxY]. */
export type SceneBounds = [number, number, number, number];

export type ReliableMessage =
  /** Elements whose version went up since the sender last sent them */
  | { t: 'el'; board: number; elements: BoardElement[] }
  /** A client that just opened the board asks for anything newer than the saved scene */
  | { t: 'req'; board: number; have: number }
  /** The leader's whole scene, sent to whoever asked */
  | { t: 'full'; board: number; version: number; elements: BoardElement[] }
  /** The leader saved; everyone can show "Saved" and build on this version */
  | { t: 'saved'; board: number; version: number };

export type LiveMessage =
  | { t: 'ptr'; board: number; x: number; y: number; tool: 'pointer' | 'laser'; down: boolean }
  /** What the leader currently sees, so viewers can follow it */
  | { t: 'view'; board: number; bounds: SceneBounds };

export interface BoardRoles {
  hostIdentity: string | null | undefined;
  cohostIdentities: readonly string[];
  /** Co-presenters plus whoever is sharing their screen */
  presenterIdentities: readonly string[];
}

/** Host, co-hosts and presenters may draw; everyone else watches. */
export function canEditBoard(identity: string, roles: BoardRoles): boolean {
  return (
    (!!roles.hostIdentity && identity === roles.hostIdentity) ||
    roles.cohostIdentities.includes(identity) ||
    roles.presenterIdentities.includes(identity)
  );
}

/**
 * The one client that saves the board and whose view everyone follows: a presenter, else the
 * host, else a co-host. Every client works this out from the same room state, so no election
 * messages are needed. Ties break on identity so every client picks the same person.
 */
export function boardLeader(present: Iterable<string>, roles: BoardRoles): string | null {
  const here = new Set(present);
  const pick = (ids: readonly string[]) => [...ids].filter((id) => here.has(id)).sort()[0] ?? null;
  return (
    pick(roles.presenterIdentities) ??
    (roles.hostIdentity && here.has(roles.hostIdentity) ? roles.hostIdentity : null) ??
    pick(roles.cohostIdentities)
  );
}

/**
 * Elements to send: those whose version is newer than what this client last sent or received.
 * Updates `known` so the same change isn't sent twice.
 */
export function takeChangedElements(
  elements: readonly BoardElement[],
  known: Map<string, number>,
): BoardElement[] {
  const changed: BoardElement[] = [];
  for (const el of elements) {
    if ((known.get(el.id) ?? -1) < el.version) {
      known.set(el.id, el.version);
      changed.push(el);
    }
  }
  return changed;
}

/** Records elements that arrived from others, so they are not echoed back. */
export function rememberElements(elements: readonly BoardElement[], known: Map<string, number>): void {
  for (const el of elements) {
    if ((known.get(el.id) ?? -1) < el.version) known.set(el.id, el.version);
  }
}

/** Scroll and zoom that show `bounds` centred in a width × height viewport. */
export function fitBounds(
  bounds: SceneBounds,
  width: number,
  height: number,
): { scrollX: number; scrollY: number; zoom: number } {
  const [x1, y1, x2, y2] = bounds;
  const bw = Math.max(1, x2 - x1);
  const bh = Math.max(1, y2 - y1);
  const zoom = Math.min(30, Math.max(0.1, Math.min(width / bw, height / bh)));
  // Excalidraw maps scene to screen as (scene + scroll) * zoom
  return {
    zoom,
    scrollX: (width / zoom - bw) / 2 - x1,
    scrollY: (height / zoom - bh) / 2 - y1,
  };
}

/** The board's text in drawing order, for search and Doc AI. */
export function boardText(elements: readonly BoardElement[]): string {
  return elements
    .filter((el) => !el.isDeleted && el.type === 'text' && typeof el.text === 'string' && el.text.trim())
    .map((el) => (el.text as string).trim())
    .join('\n');
}

/** What is saved to Kloud: an Excalidraw file without deleted elements. */
export function serializeBoard(elements: readonly BoardElement[]): string {
  return JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'kloudmeet',
    elements: elements.filter((el) => !el.isDeleted),
    appState: { viewBackgroundColor: '#ffffff', gridSize: null },
    files: {},
  });
}

/** Elements of a saved scene, or [] when it is missing or unreadable. */
export function parseSavedBoard(scene: string | null | undefined): BoardElement[] {
  if (!scene) return [];
  try {
    const parsed = JSON.parse(scene) as { elements?: unknown };
    return Array.isArray(parsed.elements) ? parsed.elements.filter(isBoardElement) : [];
  } catch {
    return [];
  }
}

function isBoardElement(v: unknown): v is BoardElement {
  if (!v || typeof v !== 'object') return false;
  const el = v as Record<string, unknown>;
  return (
    typeof el.id === 'string' &&
    typeof el.type === 'string' &&
    Number.isFinite(el.version) &&
    Number.isFinite(el.versionNonce)
  );
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseReliable(raw: string): ReliableMessage | null {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object' || !isNum(m.board)) return null;
  const board = m.board;
  if (m.t === 'el' || m.t === 'full') {
    if (!Array.isArray(m.elements)) return null;
    const elements = m.elements.filter(isBoardElement);
    if (m.t === 'el') return { t: 'el', board, elements };
    return isNum(m.version) ? { t: 'full', board, version: m.version, elements } : null;
  }
  if (m.t === 'req') return isNum(m.have) ? { t: 'req', board, have: m.have } : null;
  if (m.t === 'saved') return isNum(m.version) ? { t: 'saved', board, version: m.version } : null;
  return null;
}

export function parseLive(raw: string): LiveMessage | null {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object' || !isNum(m.board)) return null;
  if (m.t === 'ptr') {
    if (!isNum(m.x) || !isNum(m.y)) return null;
    return {
      t: 'ptr',
      board: m.board,
      x: m.x,
      y: m.y,
      tool: m.tool === 'laser' ? 'laser' : 'pointer',
      down: m.down === true,
    };
  }
  if (m.t === 'view') {
    const b = m.bounds;
    if (!Array.isArray(b) || b.length !== 4 || !b.every(isNum)) return null;
    if (b[2] <= b[0] || b[3] <= b[1]) return null;
    return { t: 'view', board: m.board, bounds: [b[0], b[1], b[2], b[3]] };
  }
  return null;
}
