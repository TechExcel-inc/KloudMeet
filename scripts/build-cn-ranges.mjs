/**
 * Download mainland China CIDR lists and write lib/geo/cnRanges.ts.
 *
 * Usage: node scripts/build-cn-ranges.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sources = {
  v4: 'https://ispip.clang.cn/all_cn.txt',
  v6: 'https://ispip.clang.cn/all_cn_ipv6.txt',
};

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.text();
}

function ipv4ToInt(ip) {
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

function ipv6ToBigInt(raw) {
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

function mergeV4(ranges) {
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const prev = merged[merged.length - 1];
    if (prev && range[0] <= prev[1] + 1) {
      if (range[1] > prev[1]) prev[1] = range[1];
      continue;
    }
    merged.push([range[0], range[1]]);
  }
  return merged;
}

function cidrV4(cidr) {
  const [ip, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  const start = ipv4ToInt(ip);
  if (start === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const size = 2 ** (32 - bits);
  return [start, start + size - 1];
}

const v4 = [];
const v6 = [];
for (const line of (await download(sources.v4)).split(/\r?\n/)) {
  const cidr = line.trim();
  if (!cidr || cidr.startsWith('#')) continue;
  const range = cidrV4(cidr);
  if (range) v4.push(range);
}
for (const line of (await download(sources.v6)).split(/\r?\n/)) {
  const cidr = line.trim();
  if (!cidr || cidr.startsWith('#')) continue;
  const [ip, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  const start = ipv6ToBigInt(ip);
  if (start === null || !Number.isInteger(bits) || bits < 0 || bits > 128) continue;
  v6.push([start.toString(), bits]);
}

const payload = { v4: mergeV4(v4), v6 };
const literal = JSON.stringify(JSON.stringify(payload));
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'geo');
mkdirSync(dir, { recursive: true });
const out = join(dir, 'cnRanges.ts');
writeFileSync(
  out,
  `/** Mainland China IP ranges from ispip.clang.cn. Regenerate with scripts/build-cn-ranges.mjs */\nexport const CN_RANGES_JSON: string = ${literal};\n`,
);
console.log(`v4 ${payload.v4.length} v6 ${payload.v6.length}`);
