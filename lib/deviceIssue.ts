/** Why a capture device couldn't start, in terms the user can act on. */
export type DeviceIssue = 'blocked' | 'in-use' | 'not-found' | 'failed';

export function classifyDeviceError(error: unknown): DeviceIssue {
  const name = (error as { name?: string } | null)?.name ?? '';
  const message = String((error as { message?: string } | null)?.message ?? error ?? '').toLowerCase();
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || message.includes('permission')) return 'blocked';
  if (name === 'NotReadableError' || name === 'TrackStartError' || message.includes('could not start')) return 'in-use';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || message.includes('not found')) return 'not-found';
  return 'failed';
}
