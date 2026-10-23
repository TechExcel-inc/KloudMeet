import { describe, it, expect } from 'vitest';
import { attendanceOverlapsRecording } from './recordingAttendance';

const t = (min: number) => new Date(Date.UTC(2026, 9, 22, 10, min));
const now = t(120);

describe('attendanceOverlapsRecording', () => {
  const recording = { createdAt: t(30), mediaStartedAt: t(31), durationSeconds: 20 * 60 }; // 10:31–10:51

  it('grants access when the attendee was present during the recording', () => {
    expect(attendanceOverlapsRecording({ joinedAt: t(0), leftAt: t(40) }, recording, now)).toBe(true);
    expect(attendanceOverlapsRecording({ joinedAt: t(45), leftAt: t(90) }, recording, now)).toBe(true);
  });

  it('denies access to someone who left before the recording started', () => {
    expect(attendanceOverlapsRecording({ joinedAt: t(0), leftAt: t(20) }, recording, now)).toBe(false);
  });

  it('denies access to someone who joined after the recording ended', () => {
    expect(attendanceOverlapsRecording({ joinedAt: t(60), leftAt: null }, recording, now)).toBe(false);
  });

  it('treats a still-present attendee as present until now', () => {
    expect(attendanceOverlapsRecording({ joinedAt: t(10), leftAt: null }, recording, now)).toBe(true);
  });

  it('treats an in-progress recording (no duration) as running until now', () => {
    const live = { createdAt: t(100), mediaStartedAt: null, durationSeconds: null };
    expect(attendanceOverlapsRecording({ joinedAt: t(110), leftAt: null }, live, now)).toBe(true);
    expect(attendanceOverlapsRecording({ joinedAt: t(0), leftAt: t(50) }, live, now)).toBe(false);
  });

  it('falls back to createdAt when mediaStartedAt is missing', () => {
    const rec = { createdAt: t(30), durationSeconds: 60 };
    expect(attendanceOverlapsRecording({ joinedAt: t(30), leftAt: t(30) }, rec, now)).toBe(true);
  });
});
