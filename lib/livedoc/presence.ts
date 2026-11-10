/**
 * Who was in a LiveDoc Full recording, and whether their microphone and camera were on.
 * Events are stored in time order; the replay folds them up to the clock.
 */

export const PRESENCE_KINDS = ['room', 'mic', 'cam'] as const;
export type PresenceKind = (typeof PRESENCE_KINDS)[number];

export interface PresenceEvent {
  identity: string;
  name: string;
  kind: PresenceKind;
  /** room: in the meeting. mic / cam: that device is on */
  on: boolean;
  /** Milliseconds from the LiveDoc recording's start */
  atMs: number;
}

export interface PresentPerson {
  identity: string;
  name: string;
  mic: boolean;
  cam: boolean;
}

export function isPresenceKind(value: unknown): value is PresenceKind {
  return typeof value === 'string' && (PRESENCE_KINDS as readonly string[]).includes(value);
}

/**
 * peopleAt — 录制时间 atMs 时还在会里的人，按入会顺序。
 * 麦克风和摄像头在没有记录前视为关。
 */
export function peopleAt(events: readonly PresenceEvent[], atMs: number): PresentPerson[] {
  const byId = new Map<string, PresentPerson & { present: boolean }>();
  const sorted = [...events].sort((a, b) => a.atMs - b.atMs);
  for (const event of sorted) {
    if (event.atMs > atMs) break;
    const current = byId.get(event.identity) ?? {
      identity: event.identity,
      name: event.name,
      mic: false,
      cam: false,
      present: false,
    };
    if (event.name) current.name = event.name;
    if (event.kind === 'room') {
      current.present = event.on;
      if (!event.on) {
        current.mic = false;
        current.cam = false;
      }
    } else if (event.kind === 'mic') {
      current.mic = event.on;
    } else {
      current.cam = event.on;
    }
    byId.set(event.identity, current);
  }
  const people: PresentPerson[] = [];
  for (const person of byId.values()) {
    if (!person.present) continue;
    people.push({ identity: person.identity, name: person.name, mic: person.mic, cam: person.cam });
  }
  return people;
}
