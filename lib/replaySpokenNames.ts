import type { PresentationSlide } from '@/lib/meetingPresentation';
import type { ReplayAttendee } from '@/lib/replaySpeakerIdentity';

const scriptByLanguage: Record<string, RegExp> = {
  zh: /\p{Script=Han}/u,
  ja: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
  ko: /\p{Script=Hangul}/u,
};

type SpokenSlide = Pick<PresentationSlide, 'narration' | 'nameMentions' | 'attribution'>;

/** Use verified roster names for speech only. The write still displays account usernames. */
export function createReplaySpokenNames(attendees: readonly ReplayAttendee[], language: string) {
  const names = new Map<string, { username: string; spoken: string }>();
  const script = scriptByLanguage[language.split('-')[0]];
  for (const { teamMember, displayName } of attendees) {
    const username = teamMember?.username.trim();
    if (!teamMember || !username) continue;
    const forms = [teamMember.fullName?.trim(), displayName.trim()]
      .filter((form): form is string => Boolean(form && form.toLowerCase() !== username.toLowerCase()));
    const spoken = (script && forms.find(form => script.test(form))) || forms[0] || username;
    const key = `member:${teamMember.id}`;
    const previous = names.get(key);
    if (!previous || previous.spoken === previous.username) names.set(key, { username, spoken });
  }

  return ({ narration, nameMentions, attribution }: SpokenSlide) => {
    if (Array.isArray(nameMentions)) {
      let output = '';
      let cursor = 0;
      for (const { key, start, end } of nameMentions) {
        const name = names.get(key);
        if (!name || !Number.isInteger(start) || !Number.isInteger(end) ||
          start < cursor || end <= start || narration.slice(start, end) !== name.username) continue;
        output += narration.slice(cursor, start) + name.spoken;
        cursor = end;
      }
      return output + narration.slice(cursor);
    }

    // Older passages record the speaker identity but have no linked names in the body.
    // Only update an exact leading attribution. Other words may look like usernames.
    const name = attribution && names.get(attribution.key);
    if (!name || !narration.startsWith(name.username)) return narration;
    const next = narration.slice(name.username.length);
    return /^[\p{Script=Latin}\p{N}_@]/u.test(next) ? narration : name.spoken + next;
  };
}
