/**
 * Minimal Stripe client over the REST API (no SDK dependency).
 *
 * Only what billing v1 needs: customers, Checkout Sessions, Billing Portal
 * sessions, and webhook signature verification. Keys come from env
 * (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET) and are never logged.
 */
import crypto from 'crypto';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
/** Signature timestamps older than this are rejected (Stripe's default tolerance). */
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

export class StripeConfigError extends Error {}

export class StripeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly type?: string,
  ) {
    super(message);
  }
}

export class StripeSignatureError extends Error {}

export function getStripeSecretKey(env: Partial<NodeJS.ProcessEnv> = process.env): string {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new StripeConfigError('STRIPE_SECRET_KEY is not configured');
  return key;
}

type FormValue = string | number | boolean | null | undefined | FormValue[] | { [k: string]: FormValue };

/** Encode nested params the way Stripe expects: a[b][0][c]=v. */
export function encodeStripeForm(params: Record<string, FormValue>): URLSearchParams {
  const out = new URLSearchParams();
  const walk = (prefix: string, value: FormValue) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${prefix}[${i}]`, v));
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(`${prefix}[${k}]`, v);
    } else {
      out.append(prefix, String(value));
    }
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return out;
}

export interface StripeRequestOptions {
  idempotencyKey?: string;
  fetchImpl?: typeof fetch;
  env?: Partial<NodeJS.ProcessEnv>;
}

export async function stripeRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, FormValue> = {},
  options: StripeRequestOptions = {},
): Promise<T> {
  const env = options.env ?? process.env;
  const key = getStripeSecretKey(env);
  const doFetch = options.fetchImpl ?? fetch;
  const body = encodeStripeForm(params);
  const url = method === 'GET' && body.toString() ? `${STRIPE_API_BASE}${path}?${body}` : `${STRIPE_API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  const version = env.STRIPE_API_VERSION?.trim();
  if (version) headers['Stripe-Version'] = version;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  const res = await doFetch(url, {
    method,
    headers,
    body: method === 'POST' ? body.toString() : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; type?: string } };
  if (!res.ok) {
    throw new StripeApiError(json.error?.message || `Stripe request failed (${res.status})`, res.status, json.error?.type);
  }
  return json as T;
}

/* ─────────────────────────── object shapes we read ─────────────────────────── */

export type StripeMetadata = Record<string, string | undefined>;

export interface StripeCustomer {
  id: string;
}

export interface StripeCheckoutSession {
  id: string;
  object: 'checkout.session';
  url?: string | null;
  mode: 'subscription' | 'payment' | 'setup';
  customer?: string | null;
  subscription?: string | null;
  client_reference_id?: string | null;
  payment_status?: 'paid' | 'unpaid' | 'no_payment_required';
  created?: number;
  metadata?: StripeMetadata | null;
}

export interface StripeSubscriptionItem {
  id?: string;
  quantity?: number | null;
  price?: { id: string } | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
}

export interface StripeSubscription {
  id: string;
  object: 'subscription';
  customer: string;
  status: string;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
  items?: { data: StripeSubscriptionItem[] };
  metadata?: StripeMetadata | null;
}

export interface StripeInvoice {
  id: string;
  object: 'invoice';
  customer?: string | null;
  subscription?: string | null;
  parent?: { subscription_details?: { subscription?: string | null } | null } | null;
}

export interface StripeEvent<T = unknown> {
  id: string;
  type: string;
  created: number;
  data: { object: T };
}

export interface StripePortalSession {
  id: string;
  url: string;
}

/* ─────────────────────────── API calls ─────────────────────────── */

export async function createStripeCustomer(
  input: { email?: string | null; name?: string | null; accountId: number },
  options?: StripeRequestOptions,
): Promise<StripeCustomer> {
  return stripeRequest<StripeCustomer>(
    'POST',
    '/customers',
    {
      email: input.email ?? undefined,
      name: input.name ?? undefined,
      metadata: { accountId: String(input.accountId) },
    },
    { idempotencyKey: `kloudmeet-customer-${input.accountId}`, ...options },
  );
}

export async function createCheckoutSession(
  params: Record<string, FormValue>,
  options?: StripeRequestOptions,
): Promise<StripeCheckoutSession> {
  return stripeRequest<StripeCheckoutSession>('POST', '/checkout/sessions', params, options);
}

export async function createPortalSession(
  input: { customer: string; returnUrl: string },
  options?: StripeRequestOptions,
): Promise<StripePortalSession> {
  return stripeRequest<StripePortalSession>(
    'POST',
    '/billing_portal/sessions',
    { customer: input.customer, return_url: input.returnUrl },
    options,
  );
}

/* ─────────────────────────── webhooks ─────────────────────────── */

/** HMAC-SHA256 of `${timestamp}.${payload}` — the v1 scheme Stripe signs webhooks with. */
export function computeStripeSignature(payload: string, timestamp: number, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
}

/**
 * Verify the `Stripe-Signature` header and parse the event.
 * Throws StripeSignatureError on a missing / stale / wrong signature.
 */
export function constructStripeEvent(
  payload: string,
  header: string | null,
  secret: string,
  nowMs: number = Date.now(),
  toleranceSeconds: number = STRIPE_SIGNATURE_TOLERANCE_SECONDS,
): StripeEvent {
  if (!header) throw new StripeSignatureError('Missing Stripe-Signature header');
  let timestamp = NaN;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2).map((s) => s?.trim());
    if (k === 't') timestamp = Number(v);
    else if (k === 'v1' && v) signatures.push(v);
  }
  if (!Number.isFinite(timestamp) || signatures.length === 0) {
    throw new StripeSignatureError('Malformed Stripe-Signature header');
  }
  if (Math.abs(nowMs / 1000 - timestamp) > toleranceSeconds) {
    throw new StripeSignatureError('Stripe signature timestamp outside tolerance');
  }
  const expected = Buffer.from(computeStripeSignature(payload, timestamp, secret), 'hex');
  const ok = signatures.some((sig) => {
    const got = Buffer.from(sig, 'hex');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
  if (!ok) throw new StripeSignatureError('Stripe signature mismatch');
  try {
    return JSON.parse(payload) as StripeEvent;
  } catch {
    throw new StripeSignatureError('Stripe payload is not valid JSON');
  }
}
