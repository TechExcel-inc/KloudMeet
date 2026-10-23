import type { Metadata } from 'next';
import { BillingPageClient } from './BillingPageClient';

export const metadata: Metadata = {
  title: 'Plan & billing · Kloud Meet',
  robots: { index: false, follow: false },
};

export default function BillingPage() {
  return <BillingPageClient />;
}
