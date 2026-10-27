import { describe, expect, it } from 'vitest';
import {
  KNOCK_RETRY_AFTER_MS,
  decideJoin,
  decideRecordingView,
  joinBlockCode,
  joinLevelOf,
  mayKnockAgain,
  memberDefaultAccessLevel,
  parseAccessLevel,
  type JoinFacts,
  type RecordingFacts,
} from './meetingAccess';
import { safeReplayNext } from './recordingReplayPath';

const nobody: JoinFacts = {
  level: 'PROTECTED',
  isRecorder: false,
  signedIn: true,
  isHost: false,
  isCohost: false,
  isCompanyMember: false,
  invitedByEmail: false,
  hasInviteLink: false,
  joinedBefore: false,
  request: null,
};
const join = (f: Partial<JoinFacts>) => decideJoin({ ...nobody, ...f });

describe('memberDefaultAccessLevel', () => {
  it('is Public when the person never chose one', () => {
    expect(memberDefaultAccessLevel(null, true)).toBe('PUBLIC');
    expect(memberDefaultAccessLevel(undefined, false)).toBe('PUBLIC');
    expect(memberDefaultAccessLevel('nonsense', true)).toBe('PUBLIC');
  });

  it('uses the saved choice', () => {
    expect(memberDefaultAccessLevel('PROTECTED', false)).toBe('PROTECTED');
    expect(memberDefaultAccessLevel('PUBLIC', true)).toBe('PUBLIC');
    expect(memberDefaultAccessLevel('PRIVATE', true)).toBe('PRIVATE');
  });

  it('turns Private into Protected without a company', () => {
    expect(memberDefaultAccessLevel('PRIVATE', false)).toBe('PROTECTED');
  });
});

describe('parseAccessLevel / joinLevelOf', () => {
  it('accepts stored and dropdown values', () => {
    expect(parseAccessLevel('PRIVATE')).toBe('PRIVATE');
    expect(parseAccessLevel('protected')).toBe('PROTECTED');
    expect(parseAccessLevel(' public ')).toBe('PUBLIC');
    expect(parseAccessLevel('secret')).toBeNull();
    expect(parseAccessLevel(null)).toBeNull();
  });

  it('treats meetings from before access levels as Public', () => {
    expect(joinLevelOf(null)).toBe('PUBLIC');
    expect(joinLevelOf('PRIVATE')).toBe('PRIVATE');
  });
});

describe('decideJoin', () => {
  it('lets anyone into Public and legacy meetings, signed in or not', () => {
    expect(join({ level: 'PUBLIC', signedIn: false })).toEqual({ kind: 'join' });
    expect(join({ level: null, signedIn: false })).toEqual({ kind: 'join' });
  });

  it('always lets the host and the recorder bot in', () => {
    expect(join({ level: 'PRIVATE', isHost: true })).toEqual({ kind: 'join' });
    expect(join({ level: 'PRIVATE', signedIn: false, isRecorder: true })).toEqual({ kind: 'join' });
  });

  describe('Protected', () => {
    it('lets company members, invitees, co-hosts and returning people in', () => {
      for (const f of [{ isCompanyMember: true }, { invitedByEmail: true }, { isCohost: true }, { joinedBefore: true }, { request: 'ADMITTED' as const }]) {
        expect(join(f)).toEqual({ kind: 'join' });
      }
    });

    it('lets an invite link in without signing in', () => {
      expect(join({ signedIn: false, hasInviteLink: true })).toEqual({ kind: 'join' });
    });

    it('asks signed-out visitors to sign in first', () => {
      expect(join({ signedIn: false })).toEqual({ kind: 'sign_in' });
    });

    it('makes anyone else knock, and remembers a pending or denied knock', () => {
      expect(join({})).toEqual({ kind: 'knock', pending: false });
      expect(join({ request: 'PENDING' })).toEqual({ kind: 'knock', pending: true });
      expect(join({ request: 'CANCELED' })).toEqual({ kind: 'knock', pending: false });
      expect(join({ request: 'DENIED' })).toEqual({ kind: 'refused', reason: 'DENIED' });
    });
  });

  describe('Private', () => {
    const priv = (f: Partial<JoinFacts>) => join({ level: 'PRIVATE', ...f });

    it('lets invited company members in, by email or by their link', () => {
      expect(priv({ isCompanyMember: true, invitedByEmail: true })).toEqual({ kind: 'join' });
      expect(priv({ isCompanyMember: true, hasInviteLink: true })).toEqual({ kind: 'join' });
    });

    it('refuses company members who were not invited, and invitees outside the company', () => {
      expect(priv({ isCompanyMember: true })).toEqual({ kind: 'refused', reason: 'NOT_INVITED' });
      expect(priv({ invitedByEmail: true })).toEqual({ kind: 'refused', reason: 'NOT_INVITED' });
    });

    it('needs sign-in even with an invite link', () => {
      expect(priv({ signedIn: false, hasInviteLink: true })).toEqual({ kind: 'sign_in' });
    });

    it('never knocks', () => {
      expect(priv({ request: 'ADMITTED' })).toEqual({ kind: 'refused', reason: 'NOT_INVITED' });
    });

    it('lets people already in the meeting reconnect', () => {
      expect(priv({ joinedBefore: true })).toEqual({ kind: 'join' });
      expect(priv({ isCohost: true })).toEqual({ kind: 'join' });
    });
  });

  it('maps decisions to the codes connection-details returns', () => {
    expect(joinBlockCode({ kind: 'join' })).toBeNull();
    expect(joinBlockCode({ kind: 'sign_in' })).toBe('SIGN_IN_REQUIRED');
    expect(joinBlockCode({ kind: 'knock', pending: true })).toBe('KNOCK_REQUIRED');
    expect(joinBlockCode({ kind: 'refused', reason: 'NOT_INVITED' })).toBe('NOT_INVITED');
    expect(joinBlockCode({ kind: 'refused', reason: 'DENIED' })).toBe('DENIED');
  });
});

describe('mayKnockAgain', () => {
  it('allows one new request a minute after a denial', () => {
    const now = Date.now();
    expect(mayKnockAgain(null, now)).toBe(true);
    expect(mayKnockAgain(new Date(now - 10_000), now)).toBe(false);
    expect(mayKnockAgain(new Date(now - KNOCK_RETRY_AFTER_MS), now)).toBe(true);
  });
});

describe('decideRecordingView', () => {
  const viewer: RecordingFacts = {
    level: 'PROTECTED',
    visibility: 'PRIVATE',
    signedIn: true,
    isRecorderOrHost: false,
    attended: false,
    isCompanyMember: false,
    invited: false,
    approved: false,
  };
  const view = (f: Partial<RecordingFacts>) => decideRecordingView({ ...viewer, ...f });

  it('plays the host’s "Anyone with the link" recordings and Public meetings for everyone', () => {
    expect(view({ visibility: 'PUBLIC', level: 'PRIVATE', signedIn: false })).toEqual({ kind: 'watch' });
    expect(view({ level: 'PUBLIC', signedIn: false })).toEqual({ kind: 'watch' });
  });

  it('asks signed-out viewers to sign in otherwise', () => {
    expect(view({ signedIn: false })).toEqual({ kind: 'sign_in' });
    expect(view({ level: null, signedIn: false })).toEqual({ kind: 'sign_in' });
  });

  it('Protected: attendees, the company, invitees and approved people watch; others ask', () => {
    for (const f of [{ attended: true }, { isRecorderOrHost: true }, { isCompanyMember: true }, { invited: true }, { approved: true }]) {
      expect(view(f)).toEqual({ kind: 'watch' });
    }
    expect(view({})).toEqual({ kind: 'request' });
  });

  it('Private: only attendees (and the host / recorder); nothing to ask for', () => {
    expect(view({ level: 'PRIVATE', attended: true })).toEqual({ kind: 'watch' });
    expect(view({ level: 'PRIVATE', isRecorderOrHost: true })).toEqual({ kind: 'watch' });
    expect(view({ level: 'PRIVATE', isCompanyMember: true, invited: true, approved: true })).toEqual({ kind: 'refused' });
  });

  it('legacy private recordings: attendees watch, others ask the host', () => {
    expect(view({ level: null, attended: true })).toEqual({ kind: 'watch' });
    expect(view({ level: null })).toEqual({ kind: 'request' });
    expect(view({ level: null, approved: true })).toEqual({ kind: 'watch' });
  });
});

describe('safeReplayNext', () => {
  it('allows a replay or a meeting as the return path after signing in', () => {
    expect(safeReplayNext('/recordings/abc')).toBe('/recordings/abc');
    expect(safeReplayNext('/rooms/yieg-kgxf')).toBe('/rooms/yieg-kgxf');
  });

  it('rejects anything else', () => {
    for (const raw of ['/rooms/a/b', '//evil.com', '/rooms/', 'https://evil.com/rooms/x', '/rooms/x?y=1', '/dashboard']) {
      expect(safeReplayNext(raw)).toBeNull();
    }
  });
});
