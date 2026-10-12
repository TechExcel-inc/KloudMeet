/**
 * chinaIp — 用本地中国大陆 IP 段判断客户端在国内还是国外。
 * 数据来自 ispip 的大陆地址段，不含香港、澳门、台湾。
 */
import { CN_RANGES_JSON } from './cnRanges';

type IpRegion = 'cn' | 'intl' | 'unknown';

interface RangeFile {
  v4: [number, number][];
  v6: [string, number][];
}

interface LoadedRanges {
  v4: [number, number][];
  v6: [bigint, number][];
}

let cache: LoadedRanges | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRangeFile(value: unknown): value is RangeFile {
  if (!isRecord(value) || !Array.isArray(value.v4) || !Array.isArray(value.v6)) return false;
  const first = value.v4[0];
  return Array.isArray(first) && typeof first[0] === 'number' && typeof first[1] === 'number';
}

function loadRanges(): LoadedRanges {
  if (cache) return cache;
  const parsed: unknown = JSON.parse(CN_RANGES_JSON);
  if (!isRangeFile(parsed)) throw new Error('Invalid China IP range data');
  cache = {
    v4: parsed.v4,
    v6: parsed.v6.map((row) => [BigInt(row[0]), row[1]]),
  };
  return cache;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const oct = Number(part);
    if (oct > 255) return null;
    n = n * 256 + oct;
  }
  return n;
}

function isPrivateV4(n: number): boolean {
  if (n <= 16777215) return true;
  if (n >= 167772160 && n <= 184549375) return true;
  if (n >= 1681915904 && n <= 1686110207) return true;
  if (n >= 2130706432 && n <= 2147483647) return true;
  if (n >= 2851995648 && n <= 2852061183) return true;
  if (n >= 2886729728 && n <= 2887778303) return true;
  if (n >= 3232235520 && n <= 3232301055) return true;
  return false;
}

function containsV4(ip: number, ranges: [number, number][]): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ranges[mid][0] <= ip) lo = mid + 1;
    else hi = mid - 1;
  }
  if (hi < 0) return false;
  return ip <= ranges[hi][1];
}

function ipv6ToBigInt(raw: string): bigint | null {
  const ip = raw.trim().toLowerCase();
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (halves.length === 2 && missing < 0) return null;
  const groups = halves.length === 2 ? [...left, ...Array(missing).fill('0'), ...right] : left;
  if (groups.length !== 8) return null;
  let n = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    n = (n << 16n) + BigInt(parseInt(group, 16));
  }
  return n;
}

function isPrivateV6(ip: bigint): boolean {
  if (ip === 1n) return true;
  if (ip >> 118n === 0x3fan) return true;
  if (ip >> 121n === 0x7en) return true;
  return false;
}

function inV6Prefix(ip: bigint, network: bigint, bits: number): boolean {
  if (bits <= 0) return true;
  const shift = 128n - BigInt(bits);
  return ip >> shift === network >> shift;
}

function classifyV4(ip: string): IpRegion {
  const n = ipv4ToInt(ip);
  if (n === null || isPrivateV4(n)) return 'unknown';
  return containsV4(n, loadRanges().v4) ? 'cn' : 'intl';
}

function classifyV6(raw: string): IpRegion {
  const ip = ipv6ToBigInt(raw);
  if (ip === null || isPrivateV6(ip)) return 'unknown';
  if (ip >> 32n === 0xffffn) {
    const n = Number(ip & 0xffffffffn);
    const dotted = [
      Math.floor(n / 16777216) % 256,
      Math.floor(n / 65536) % 256,
      Math.floor(n / 256) % 256,
      n % 256,
    ].join('.');
    return classifyV4(dotted);
  }
  const ranges = loadRanges().v6;
  for (const [network, bits] of ranges) {
    if (inV6Prefix(ip, network, bits)) return 'cn';
  }
  return 'intl';
}

/**
 * classifyIp — 判断公网地址属于中国大陆、海外，还是无法判断（内网 / 非法）
 */
export function classifyIp(raw: string): IpRegion {
  const ip = raw.trim().replace(/^\[|\]$/g, '');
  if (!ip) return 'unknown';
  if (ip.includes('.')) {
    const v4 = ip.includes(':') ? ip.slice(ip.lastIndexOf(':') + 1) : ip;
    return classifyV4(v4);
  }
  return classifyV6(ip);
}

/**
 * pickClientIp — 从代理头里取第一个公网地址
 */
export function pickClientIp(forwarded: string | null, real: string | null): string {
  const list = (forwarded ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.toLowerCase() !== 'unknown');
  const pub = list.find((ip) => classifyIp(ip) !== 'unknown');
  if (pub) return pub;
  if (list[0]) return list[0];
  const alt = (real ?? '').trim();
  if (alt && alt.toLowerCase() !== 'unknown') return alt;
  return '';
}
