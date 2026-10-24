export function encodePassphrase(passphrase: string) {
  return encodeURIComponent(passphrase);
}

export function decodePassphrase(base64String: string) {
  return decodeURIComponent(base64String);
}

/**
 * Meet-style meeting code, e.g. `abc-defg-hij` (10 random lowercase letters, ~47 bits).
 * The dash makes it distinct from personal room IDs, which are letters and digits only.
 */
export function generateRoomId(): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  // 256 % 26 bias is negligible for a meeting code.
  const s = Array.from(bytes, (b) => letters[b % letters.length]).join('');
  return `${s.slice(0, 3)}-${s.slice(3, 7)}-${s.slice(7)}`;
}

export function randomString(length: number): string {
  let result = '';
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

export function isLowPowerDevice() {
  return navigator.hardwareConcurrency < 6;
}

export function isMeetStaging() {
  return new URL(location.origin).host === 'meet.staging.livekit.io';
}
