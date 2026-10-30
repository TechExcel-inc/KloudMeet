import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./kloudSession', () => ({ authFetch: vi.fn(), getKloudSessionBearer: () => null }));
vi.mock('./useToolbarIsMobile', () => ({ isToolbarMobileUserAgent: () => false }));
vi.mock('@livekit/track-processors', () => ({ supportsBackgroundProcessors: () => true }));
vi.mock('./backgroundCutout', () => ({ createBackgroundPipeline: vi.fn() }));

import {
  companyBackgroundRules,
  findCompanyBackground,
  isCompanyBackgroundId,
  type CompanyBackgrounds,
} from './companyBackgrounds';
import { loadVideoBackground } from './videoBackground';

const acme = (over: Partial<CompanyBackgrounds> = {}): CompanyBackgrounds => ({
  id: 2,
  name: 'Acme',
  companyOnly: false,
  defaultBackgroundId: null,
  backgrounds: [
    { id: 11, name: 'Lobby', imageUrl: '/api/company-backgrounds/11/aaaa/full', thumbUrl: '/t/11' },
    { id: 12, name: 'Logo wall', imageUrl: '/api/company-backgrounds/12/bbbb/full', thumbUrl: '/t/12' },
  ],
  ...over,
});

function stubStorage(items: Record<string, string>) {
  const store = new Map(Object.entries(items));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
}

describe('company backgrounds', () => {
  it('only accepts company ids it made', () => {
    expect(isCompanyBackgroundId('company:12')).toBe(true);
    expect(isCompanyBackgroundId('company:0')).toBe(false);
    expect(isCompanyBackgroundId('company:../1')).toBe(false);
    expect(isCompanyBackgroundId('forest')).toBe(false);
  });

  it('finds an image across companies', () => {
    expect(findCompanyBackground('company:12', [acme()])?.name).toBe('Logo wall');
    expect(findCompanyBackground('company:99', [acme()])).toBeUndefined();
  });

  it('reads the default and the company-only rule', () => {
    expect(companyBackgroundRules([acme()])).toEqual({ companyOnly: false, defaultChoice: undefined });
    expect(companyBackgroundRules([acme({ defaultBackgroundId: 12, companyOnly: true })])).toEqual({
      companyOnly: true,
      defaultChoice: 'company:12',
    });
    // A default that was removed is no default.
    expect(companyBackgroundRules([acme({ defaultBackgroundId: 99 })]).defaultChoice).toBeUndefined();
  });
});

describe('loadVideoBackground with company rules', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  const cache = (c: CompanyBackgrounds) => ({ 'kloudmeet.companyBackgrounds': JSON.stringify([c]) });

  it('starts someone who never chose with the company default', () => {
    stubStorage(cache(acme({ defaultBackgroundId: 11 })));
    expect(loadVideoBackground()).toBe('company:11');
  });

  it('keeps a choice the person made, even "none"', () => {
    stubStorage({ ...cache(acme({ defaultBackgroundId: 11 })), 'kloudmeet.videoBackground': 'none' });
    expect(loadVideoBackground()).toBe('none');
  });

  it('company only: a built-in scene gives way to the company default, or blur', () => {
    stubStorage({ ...cache(acme({ companyOnly: true, defaultBackgroundId: 12 })), 'kloudmeet.videoBackground': 'forest' });
    expect(loadVideoBackground()).toBe('company:12');
    stubStorage({ ...cache(acme({ companyOnly: true })), 'kloudmeet.videoBackground': 'custom:3f2c9a10-5b7e' });
    expect(loadVideoBackground()).toBe('blur');
    stubStorage({ ...cache(acme({ companyOnly: true })), 'kloudmeet.videoBackground': 'blur-light' });
    expect(loadVideoBackground()).toBe('blur-light');
  });
});
