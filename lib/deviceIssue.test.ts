import { describe, expect, it } from 'vitest';
import { classifyDeviceError } from './deviceIssue';

const domError = (name: string, message = '') => Object.assign(new Error(message), { name });

describe('classifyDeviceError', () => {
  it('maps browser getUserMedia errors to what the user can do about them', () => {
    expect(classifyDeviceError(domError('NotAllowedError', 'Permission denied'))).toBe('blocked');
    expect(classifyDeviceError(domError('NotReadableError', 'Could not start video source'))).toBe('in-use');
    expect(classifyDeviceError(domError('NotFoundError', 'Requested device not found'))).toBe('not-found');
    expect(classifyDeviceError(domError('OverconstrainedError'))).toBe('not-found');
  });

  it('falls back to the message, then to a generic failure', () => {
    expect(classifyDeviceError(new Error('permission dismissed'))).toBe('blocked');
    expect(classifyDeviceError(new Error('something else'))).toBe('failed');
    expect(classifyDeviceError(undefined)).toBe('failed');
  });
});
