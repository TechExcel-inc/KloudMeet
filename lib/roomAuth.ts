/** Header carrying the caller's LiveKit participant JWT (proves they are in a room). */
export const ROOM_TOKEN_HEADER = 'x-livekit-token';

let currentRoomToken: string | null = null;

/** Called by the meeting page whenever it obtains a fresh participant JWT. */
export function setRoomAuthToken(token: string | null | undefined): void {
  currentRoomToken = token || null;
}

/** Headers proving room membership for in-room API calls (captions, STT, translation). */
export function roomAuthHeaders(): Record<string, string> {
  return currentRoomToken ? { [ROOM_TOKEN_HEADER]: currentRoomToken } : {};
}
