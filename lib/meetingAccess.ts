/**
 * Meeting access levels: who may join a meeting and who may watch its recordings.
 * Pure rules only (unit-tested); lib/meetingAccess.server.ts collects the facts from the database.
 *
 * |                         | Public | Protected                       | Private                     |
 * | host / co-host          | join   | join                            | join                        |
 * | host's company members  | join   | join                            | invited → join, else refuse |
 * | invited, outside company| join   | join (own email link, no sign-in)| refuse                     |
 * | anyone else, signed in  | join   | knock → host admits             | refuse                      |
 * | anyone else, signed out | join   | sign in, then knock             | sign in, then decide        |
 *
 * New meetings (and each new session of a personal meeting ID) start at the host's default from
 * My Profile, Public when unset; the host can still switch before or during the meeting.
 * Someone who was already in this meeting (or was admitted) rejoins without knocking.
 * Meetings from before access levels (accessLevel NULL) let anyone with the link join.
 */

export type MeetingAccessLevel = 'PUBLIC' | 'PROTECTED' | 'PRIVATE';

/** New meetings of someone who never chose a default in My Profile. */
export const DEFAULT_ACCESS_LEVEL: MeetingAccessLevel = 'PUBLIC';

export const ACCESS_LEVELS: readonly MeetingAccessLevel[] = ['PUBLIC', 'PROTECTED', 'PRIVATE'];

/** Accepts the stored value or the pre-join dropdown's lower-case value. */
export function parseAccessLevel(value: unknown): MeetingAccessLevel | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return (ACCESS_LEVELS as readonly string[]).includes(upper) ? (upper as MeetingAccessLevel) : null;
}

/**
 * Level for a person's new meeting: their saved default (My Profile → Meeting settings), else Public.
 * Private needs a company to invite from; without one it falls back to Protected.
 */
export function memberDefaultAccessLevel(saved: unknown, hasCompany: boolean): MeetingAccessLevel {
  const level = parseAccessLevel(saved) ?? DEFAULT_ACCESS_LEVEL;
  return level === 'PRIVATE' && !hasCompany ? 'PROTECTED' : level;
}

/** Joining a legacy meeting (no level stored) works as Public. */
export function joinLevelOf(stored: string | null | undefined): MeetingAccessLevel {
  return parseAccessLevel(stored) ?? 'PUBLIC';
}

export type JoinRequestStatus = 'PENDING' | 'ADMITTED' | 'DENIED' | 'CANCELED';

export function parseJoinRequestStatus(value: unknown): JoinRequestStatus | null {
  return value === 'PENDING' || value === 'ADMITTED' || value === 'DENIED' || value === 'CANCELED'
    ? value
    : null;
}

export interface JoinFacts {
  /** Meeting.accessLevel as stored (NULL = legacy meeting). */
  level: string | null;
  /** The LiveKit recorder bot of a recording in progress for this meeting. */
  isRecorder: boolean;
  signedIn: boolean;
  /** The meeting's creator. */
  isHost: boolean;
  /** The current host or a co-host, as the host's client reported them. */
  isCohost: boolean;
  /** Active member (or owner/admin) of the meeting's company account. */
  isCompanyMember: boolean;
  /** The signed-in account's email is on the meeting's attendee list. */
  invitedByEmail: boolean;
  /** Opened the meeting from an attendee's own email link (?invite=). */
  hasInviteLink: boolean;
  /** Already took part in this meeting (a reconnect or a second visit). */
  joinedBefore: boolean;
  /** This person's knock, if any. */
  request: JoinRequestStatus | null;
}

export type JoinRefusal = 'NOT_INVITED' | 'DENIED';

export type JoinDecision =
  | { kind: 'join' }
  | { kind: 'sign_in' }
  | { kind: 'knock'; pending: boolean }
  | { kind: 'refused'; reason: JoinRefusal };

export function decideJoin(f: JoinFacts): JoinDecision {
  if (f.isRecorder || f.isHost) return { kind: 'join' };
  const level = joinLevelOf(f.level);
  if (level === 'PUBLIC') return { kind: 'join' };

  if (level === 'PROTECTED') {
    // The email link is the invitation itself: no sign-in needed.
    if (f.hasInviteLink) return { kind: 'join' };
    if (!f.signedIn) return { kind: 'sign_in' };
    if (f.isCohost || f.isCompanyMember || f.invitedByEmail || f.joinedBefore || f.request === 'ADMITTED') {
      return { kind: 'join' };
    }
    if (f.request === 'DENIED') return { kind: 'refused', reason: 'DENIED' };
    return { kind: 'knock', pending: f.request === 'PENDING' };
  }

  // PRIVATE: only the company's invited members (and whoever is already in it).
  if (!f.signedIn) return { kind: 'sign_in' };
  if (f.isCohost || f.joinedBefore) return { kind: 'join' };
  if (f.isCompanyMember && (f.invitedByEmail || f.hasInviteLink)) return { kind: 'join' };
  return { kind: 'refused', reason: 'NOT_INVITED' };
}

/** Error codes connection-details returns (403, or 401 for sign-in) when the decision isn't "join". */
export type JoinBlockCode = 'SIGN_IN_REQUIRED' | 'KNOCK_REQUIRED' | 'NOT_INVITED' | 'DENIED';

export function joinBlockCode(decision: JoinDecision): JoinBlockCode | null {
  switch (decision.kind) {
    case 'join':
      return null;
    case 'sign_in':
      return 'SIGN_IN_REQUIRED';
    case 'knock':
      return 'KNOCK_REQUIRED';
    case 'refused':
      return decision.reason;
  }
}

/** LiveKit data topic: the waiting list changed (host and co-hosts refetch it). */
export const JOIN_REQUESTS_TOPIC = 'kloud-join-requests';

/** Someone the host turned away may ask again, at most once a minute. */
export const KNOCK_RETRY_AFTER_MS = 60_000;

/** A waiting person who stopped polling (closed the tab) drops off the host's list. */
export const KNOCK_STALE_AFTER_MS = 45_000;

export function mayKnockAgain(respondedAt: Date | null, now = Date.now()): boolean {
  return !respondedAt || now - respondedAt.getTime() >= KNOCK_RETRY_AFTER_MS;
}

// ── Recordings ──────────────────────────────────────────────────────────────

export interface RecordingFacts {
  /** The meeting's Meeting.accessLevel as stored (NULL = legacy). */
  level: string | null;
  /** Recording.visibility: the host's "Anyone with the link" switch (PUBLIC) wins over the level. */
  visibility: string;
  signedIn: boolean;
  /** Started the recording, or hosts the meeting. */
  isRecorderOrHost: boolean;
  /** Took part in the meeting. */
  attended: boolean;
  isCompanyMember: boolean;
  invited: boolean;
  /** The host approved this person's request to watch. */
  approved: boolean;
}

export type RecordingDecision =
  | { kind: 'watch' }
  | { kind: 'sign_in' }
  /** Protected: may ask the host for access. */
  | { kind: 'request' }
  /** Private: only the meeting's attendees; nothing to ask for. */
  | { kind: 'refused' };

export function decideRecordingView(f: RecordingFacts): RecordingDecision {
  if (f.visibility === 'PUBLIC') return { kind: 'watch' };
  const level = parseAccessLevel(f.level);

  if (level === 'PUBLIC') return { kind: 'watch' };
  if (!f.signedIn) return { kind: 'sign_in' };
  if (f.isRecorderOrHost || f.attended) return { kind: 'watch' };

  if (level === 'PRIVATE') return { kind: 'refused' };
  if (level === 'PROTECTED' && (f.isCompanyMember || f.invited)) return { kind: 'watch' };

  // Protected, or a private recording of a meeting from before access levels: others ask the host.
  return f.approved ? { kind: 'watch' } : { kind: 'request' };
}
