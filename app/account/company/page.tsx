import type { Metadata } from 'next';
import { CompanyPageClient } from './CompanyPageClient';

export const metadata: Metadata = {
  title: 'Company settings · Kloud Meet',
  robots: { index: false, follow: false },
};

export default function CompanyPage() {
  return <CompanyPageClient />;
}
