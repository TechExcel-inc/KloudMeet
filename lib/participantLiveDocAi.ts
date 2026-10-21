/** parseParticipantLiveDocAi — 房间 metadata 未写时默认允许参会者分享文档 AI。 */
export function parseParticipantLiveDocAi(metadata: string | undefined | null): boolean {
  if (!metadata || !metadata.trim()) return true;
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (!parsed || typeof parsed !== 'object') return true;
    return (parsed as { participantLiveDocAi?: unknown }).participantLiveDocAi !== false;
  } catch {
    return true;
  }
}

/** mergeParticipantLiveDocAi — 保留 metadata 里的其他字段。 */
export function mergeParticipantLiveDocAi(
  existing: string | undefined | null,
  show: boolean,
): string {
  let base: Record<string, unknown> = {};
  if (existing && existing.trim()) {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        base = { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      base = {};
    }
  }
  return JSON.stringify({ ...base, participantLiveDocAi: show });
}

/** persistParticipantLiveDocAi — 写入本场 LiveKit 房间 metadata，只对这一场会议有效。 */
export async function persistParticipantLiveDocAi({
  roomName,
  show,
  livekitToken,
}: {
  roomName: string;
  show: boolean;
  livekitToken: string;
}): Promise<void> {
  let last = 'persist failed';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(
      `/api/meetings/${encodeURIComponent(roomName)}/participant-livedoc`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${livekitToken}`,
        },
        body: JSON.stringify({ show }),
      },
    );
    if (response.ok) return;
    last = `${response.status} ${await response.text()}`;
    if (attempt < 2) {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 400);
      });
    }
  }
  throw new Error(`persistParticipantLiveDocAi: ${last}`);
}
