import { describe, expect, it } from 'vitest';
import { classifyIp, pickClientIp } from './chinaIp';

describe('classifyIp', () => {
  it('treats mainland public addresses as China', () => {
    expect(classifyIp('114.114.114.114')).toBe('cn');
    expect(classifyIp('223.5.5.5')).toBe('cn');
    expect(classifyIp('1.2.4.8')).toBe('cn');
  });

  it('treats well-known overseas addresses as international', () => {
    expect(classifyIp('8.8.8.8')).toBe('intl');
    expect(classifyIp('1.1.1.1')).toBe('intl');
  });

  it('does not classify private or empty addresses', () => {
    expect(classifyIp('127.0.0.1')).toBe('unknown');
    expect(classifyIp('192.168.1.8')).toBe('unknown');
    expect(classifyIp('10.1.2.3')).toBe('unknown');
    expect(classifyIp('')).toBe('unknown');
  });

  it('reads the IPv4 embedded in a mapped address', () => {
    expect(classifyIp('::ffff:223.5.5.5')).toBe('cn');
    expect(classifyIp('::ffff:8.8.8.8')).toBe('intl');
  });
});

describe('pickClientIp', () => {
  it('skips a private proxy address and keeps the first public client', () => {
    expect(pickClientIp('10.0.0.1, 114.114.114.114', null)).toBe('114.114.114.114');
  });

  it('falls back to x-real-ip when forwarded is empty', () => {
    expect(pickClientIp(null, '8.8.8.8')).toBe('8.8.8.8');
  });
});
