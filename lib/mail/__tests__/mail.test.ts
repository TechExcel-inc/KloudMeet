import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aliyunPercentEncode, signAliyunRpc } from '../providers/aliyun';
import { clearMailRegionCache, mailRegionFor, regionFromDomain, regionFromMxHosts } from '../region';
import { providerOrder, sendMail } from '../index';
import { verificationEmail } from '../templates';

const MAIL_ENV = [
  'MAIL_PROVIDER', 'MAIL_PROVIDER_CN', 'POSTMARK_SERVER_TOKEN', 'BREVO_API_KEY',
  'ALIYUN_DM_ACCESS_KEY_ID', 'ALIYUN_DM_ACCESS_KEY_SECRET', 'ALIYUN_DM_ACCOUNT_NAME',
];

beforeEach(() => {
  for (const k of MAIL_ENV) vi.stubEnv(k, '');
  clearMailRegionCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function configureAll() {
  vi.stubEnv('POSTMARK_SERVER_TOKEN', 'pm-token');
  vi.stubEnv('BREVO_API_KEY', 'brevo-key');
  vi.stubEnv('ALIYUN_DM_ACCESS_KEY_ID', 'ak');
  vi.stubEnv('ALIYUN_DM_ACCESS_KEY_SECRET', 'secret');
  vi.stubEnv('ALIYUN_DM_ACCOUNT_NAME', 'noreply@mail.kloud.cn');
}

describe('aliyun RPC signature', () => {
  it('matches the documented example (DescribeRegions, secret "testsecret")', () => {
    const query = signAliyunRpc(
      {
        AccessKeyId: 'testid',
        Action: 'DescribeRegions',
        Format: 'XML',
        SignatureMethod: 'HMAC-SHA1',
        SignatureNonce: '3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf',
        SignatureVersion: '1.0',
        Timestamp: '2016-02-23T12:46:24Z',
        Version: '2014-05-26',
      },
      'testsecret',
      'GET',
    );
    expect(decodeURIComponent(query.split('&Signature=')[1])).toBe('OLeaidS1JvxuMvnyHOwuJ+uX5qY=');
  });

  it('percent-encodes the RFC 3986 reserved characters', () => {
    expect(aliyunPercentEncode("a b*c~d!'()")).toBe('a%20b%2Ac~d%21%27%28%29');
  });
});

describe('mail region', () => {
  it('knows Chinese consumer mailboxes and .cn domains', () => {
    expect(regionFromDomain('qq.com')).toBe('cn');
    expect(regionFromDomain('163.com')).toBe('cn');
    expect(regionFromDomain('company.com.cn')).toBe('cn');
    expect(regionFromDomain('gmail.com')).toBeNull();
  });

  it('detects Chinese enterprise mail from MX hosts', () => {
    expect(regionFromMxHosts(['mxbiz1.qq.com.'])).toBe('cn');
    expect(regionFromMxHosts(['mx1.qiye.aliyun.com'])).toBe('cn');
    expect(regionFromMxHosts(['mxw.mxhichina.com'])).toBe('cn');
    expect(regionFromMxHosts(['aspmx.l.google.com', 'alt1.aspmx.l.google.com'])).toBe('global');
    expect(regionFromMxHosts(['mail.notqq.com'])).toBe('global');
  });

  it('uses the MX lookup for unknown domains and falls back to global on errors', async () => {
    expect(await mailRegionFor('a@acme-cn.com', async () => [{ exchange: 'mxbiz1.qq.com' }])).toBe('cn');
    expect(await mailRegionFor('a@acme.io', async () => [{ exchange: 'aspmx.l.google.com' }])).toBe('global');
    expect(await mailRegionFor('a@broken.example', async () => { throw new Error('ENOTFOUND'); })).toBe('global');
  });
});

describe('provider order', () => {
  it('routes global → postmark first and Chinese mailboxes → aliyun first', () => {
    configureAll();
    expect(providerOrder('global').map((p) => p.name)).toEqual(['postmark', 'brevo', 'aliyun']);
    expect(providerOrder('cn').map((p) => p.name)).toEqual(['aliyun', 'postmark', 'brevo']);
  });

  it('skips providers without credentials and honours overrides', () => {
    vi.stubEnv('BREVO_API_KEY', 'brevo-key');
    expect(providerOrder('global').map((p) => p.name)).toEqual(['brevo']);
    configureAll();
    vi.stubEnv('MAIL_PROVIDER', 'brevo');
    expect(providerOrder('global').map((p) => p.name)).toEqual(['brevo', 'postmark', 'aliyun']);
  });
});

describe('sendMail', () => {
  const message = verificationEmail('someone@qq.com', '123456', 'signup');

  it('sends to a QQ mailbox through Aliyun with a signed request', async () => {
    configureAll();
    const fetchMock = vi.fn(async () => Response.json({ EnvId: 'env-1', RequestId: 'r' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await sendMail(message);
    expect(result).toEqual({ ok: true, provider: 'aliyun', id: 'env-1' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://dm.aliyuncs.com/');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('Action')).toBe('SingleSendMail');
    expect(body.get('AccountName')).toBe('noreply@mail.kloud.cn');
    expect(body.get('ToAddress')).toBe('someone@qq.com');
    expect(body.get('Signature')).toBeTruthy();
  });

  it('falls back to the next provider when the first fails', async () => {
    configureAll();
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('aliyuncs')
        ? Response.json({ Code: 'InvalidMailAddress.NotFound', Message: 'x' }, { status: 404 })
        : Response.json({ ErrorCode: 0, Message: 'OK', MessageID: 'pm-1' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await sendMail(message);
    expect(result).toEqual({ ok: true, provider: 'postmark', id: 'pm-1' });
    const pmInit = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect((pmInit.headers as Record<string, string>)['X-Postmark-Server-Token']).toBe('pm-token');
    expect(JSON.parse(String(pmInit.body))).toMatchObject({ To: 'someone@qq.com', MessageStream: 'outbound', Tag: 'signup-code' });
  });

  it('fails in production when nothing is configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const result = await sendMail(verificationEmail('a@gmail.com', '123456', 'reset'));
    expect(result.ok).toBe(false);
  });
});
