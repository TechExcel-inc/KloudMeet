'use client';

/**
 * Company camera backgrounds on the person's side: the images their companies' admins added
 * (Company settings → Camera backgrounds), the background they start with, and whether only
 * company images may be used. Kept in localStorage as well, because the camera starts with its
 * background synchronously, before any request could come back.
 */

import React from 'react';
import { authFetch, getKloudSessionBearer } from './kloudSession';

export type CompanyBackgroundId = `company:${number}`;

export interface CompanyBackground {
  id: number;
  name: string;
  imageUrl: string;
  thumbUrl: string;
}

export interface CompanyBackgrounds {
  id: number;
  name: string;
  companyOnly: boolean;
  defaultBackgroundId: number | null;
  backgrounds: CompanyBackground[];
}

const CACHE_KEY = 'kloudmeet.companyBackgrounds';
/** Fired on window when the list changes (fetched again, or an admin edited it on this device). */
export const COMPANY_BACKGROUNDS_EVENT = 'kloudmeet:company-backgrounds';

export function isCompanyBackgroundId(value: unknown): value is CompanyBackgroundId {
  return typeof value === 'string' && /^company:[1-9][0-9]{0,9}$/.test(value);
}

export function companyBackgroundChoice(id: number): CompanyBackgroundId {
  return `company:${id}`;
}

function idOf(choice: CompanyBackgroundId): number {
  return Number(choice.slice('company:'.length));
}

function isCompanyList(value: unknown): value is CompanyBackgrounds[] {
  return (
    Array.isArray(value) &&
    value.every(
      (c) =>
        c &&
        typeof c.id === 'number' &&
        typeof c.name === 'string' &&
        typeof c.companyOnly === 'boolean' &&
        Array.isArray(c.backgrounds),
    )
  );
}

/** The last list this device saw; empty when signed out or never fetched. */
export function cachedCompanyBackgrounds(): CompanyBackgrounds[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return isCompanyList(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function storeCache(companies: CompanyBackgrounds[]) {
  try {
    if (companies.length) localStorage.setItem(CACHE_KEY, JSON.stringify(companies));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    // Private mode: the list still shows; it just isn't remembered.
  }
  window.dispatchEvent(new CustomEvent(COMPANY_BACKGROUNDS_EVENT));
}

let inFlight: Promise<CompanyBackgrounds[]> | undefined;

/** Fetches the list again (signed in) or clears it (signed out). Never throws. */
export function refreshCompanyBackgrounds(): Promise<CompanyBackgrounds[]> {
  if (typeof window === 'undefined') return Promise.resolve([]);
  if (!getKloudSessionBearer()) {
    if (cachedCompanyBackgrounds().length) storeCache([]);
    return Promise.resolve([]);
  }
  inFlight ??= authFetch('/api/account/backgrounds')
    .then(async (res) => {
      if (res.status === 401) return [];
      if (!res.ok) return cachedCompanyBackgrounds();
      const body = (await res.json()) as { companies?: unknown };
      return isCompanyList(body.companies) ? body.companies : [];
    })
    .then((companies) => {
      if (JSON.stringify(companies) !== JSON.stringify(cachedCompanyBackgrounds())) storeCache(companies);
      return companies;
    })
    .catch(() => cachedCompanyBackgrounds())
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}

export function findCompanyBackground(
  choice: CompanyBackgroundId,
  companies: CompanyBackgrounds[] = cachedCompanyBackgrounds(),
): CompanyBackground | undefined {
  const id = idOf(choice);
  for (const company of companies) {
    const found = company.backgrounds.find((b) => b.id === id);
    if (found) return found;
  }
  return undefined;
}

export interface CompanyBackgroundRules {
  /** Built-in scenes and the person's own images are hidden. */
  companyOnly: boolean;
  /** What someone who has never chosen starts with. */
  defaultChoice?: CompanyBackgroundId;
}

/** One company's rule is enough to apply: people rarely belong to two companies with backgrounds. */
export function companyBackgroundRules(companies: CompanyBackgrounds[] = cachedCompanyBackgrounds()): CompanyBackgroundRules {
  const withDefault = companies.find(
    (c) => c.defaultBackgroundId !== null && c.backgrounds.some((b) => b.id === c.defaultBackgroundId),
  );
  return {
    companyOnly: companies.some((c) => c.companyOnly && c.backgrounds.length > 0),
    defaultChoice: withDefault ? companyBackgroundChoice(withDefault.defaultBackgroundId as number) : undefined,
  };
}

/** The person's companies' backgrounds for the picker, fetched again when it opens. */
export function useCompanyBackgrounds(enabled: boolean): CompanyBackgrounds[] {
  const [companies, setCompanies] = React.useState<CompanyBackgrounds[]>([]);
  React.useEffect(() => {
    if (!enabled) return;
    const sync = () => setCompanies(cachedCompanyBackgrounds());
    sync();
    void refreshCompanyBackgrounds();
    window.addEventListener(COMPANY_BACKGROUNDS_EVENT, sync);
    return () => window.removeEventListener(COMPANY_BACKGROUNDS_EVENT, sync);
  }, [enabled]);
  return companies;
}
