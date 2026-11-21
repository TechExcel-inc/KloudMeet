type ReplayAttendee = {
  id: number;
  displayName: string;
  teamMember: { id: number; fullName: string | null; username: string } | null;
};

type SpeakerLine = { speakerName: string; speakerMemberId?: number | null };

function normalize(name: string) {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function replaySpeakerResolver(attendees: readonly ReplayAttendee[]) {
  const byMember = new Map<number, { key: string; name: string }>();
  const aliases = new Map<string, Map<string, { key: string; name: string }>>();
  for (const attendee of attendees) {
    const member = attendee.teamMember;
    const name = member?.fullName?.trim() || member?.username.trim() || attendee.displayName.trim();
    if (!name) continue;
    const key = member ? `member:${member.id}` : `guest:${attendee.id}`;
    const identity = { key, name };
    if (member) byMember.set(member.id, identity);
    for (const value of [attendee.displayName, member?.fullName, member?.username]) {
      if (!value?.trim()) continue;
      const alias = normalize(value);
      const matches = aliases.get(alias) ?? new Map();
      matches.set(key, identity);
      aliases.set(alias, matches);
    }
  }

  return ({ speakerName, speakerMemberId }: SpeakerLine) => {
    if (speakerMemberId != null) {
      const matched = byMember.get(speakerMemberId);
      return matched ?? { key: `member:${speakerMemberId}`, name: speakerName.trim() };
    }
    const alias = normalize(speakerName);
    const matches = aliases.get(alias);
    if (matches?.size === 1) return [...matches.values()][0];
    return { key: `transcript:${alias}`, name: speakerName.trim() };
  };
}
