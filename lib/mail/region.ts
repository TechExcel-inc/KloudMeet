import { resolveMx } from 'dns/promises';

/**
 * Which mail route a recipient needs: "cn" for mailboxes hosted in mainland China (overseas senders are
 * often delayed or filtered there), "global" for everything else.
 */
export type MailRegion = 'cn' | 'global';

/** Consumer mailbox domains in mainland China. */
const CN_DOMAINS = new Set([
  'qq.com', 'vip.qq.com', 'foxmail.com',
  '163.com', '126.com', 'yeah.net', 'vip.163.com', 'vip.126.com', '188.com',
  'sina.com', 'sina.cn', 'vip.sina.com', 'sohu.com', 'tom.com', '21cn.com',
  'aliyun.com', '139.com', '189.cn', 'wo.cn',
]);

/** MX hosts of Chinese enterprise mail (Tencent Exmail, NetEase Qiye, Alibaba Mail, Coremail, 263…). */
const CN_MX_SUFFIXES = [
  '.qq.com', '.netease.com', '.163.com', '.mxhichina.com', '.aliyun.com', '.alibaba.com',
  '.coremail.cn', '.icoremail.net', '.263.net', '.263xmail.com', '.sina.net', '.21cn.com',
];

const MX_TIMEOUT_MS = 1500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { region: MailRegion; at: number }>();

export function regionFromDomain(domain: string): MailRegion | null {
  const d = domain.toLowerCase();
  if (CN_DOMAINS.has(d) || d.endsWith('.cn')) return 'cn';
  return null;
}

export function regionFromMxHosts(hosts: string[]): MailRegion {
  return hosts.some((h) => CN_MX_SUFFIXES.some((s) => `.${h.toLowerCase().replace(/\.$/, '')}`.endsWith(s))) ? 'cn' : 'global';
}

/** Decides the route for an address: known domains first, then (cached) MX lookup; any doubt → global. */
export async function mailRegionFor(
  email: string,
  lookupMx: (domain: string) => Promise<{ exchange: string }[]> = resolveMx,
): Promise<MailRegion> {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (!domain) return 'global';
  const known = regionFromDomain(domain);
  if (known) return known;

  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.region;

  let region: MailRegion = 'global';
  try {
    const records = await Promise.race([
      lookupMx(domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('mx timeout')), MX_TIMEOUT_MS)),
    ]);
    region = regionFromMxHosts(records.map((r) => r.exchange));
  } catch {
    region = 'global';
  }
  cache.set(domain, { region, at: Date.now() });
  return region;
}

export function clearMailRegionCache(): void {
  cache.clear();
}
