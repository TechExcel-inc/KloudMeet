import { AsyncLocalStorage } from 'node:async_hooks';
import { NextResponse } from 'next/server';
import catalog from './apiMessages.json';

export type ApiLocale = 'en' | 'zh' | 'ja' | 'ko';

type Row = { zh: string; ja: string; ko: string };

/** 客户端用这些值做判断，不能改成译文。 */
const KEEP = new Set(['full', 'unreadable']);

const patterns: Array<{
  re: RegExp;
  key: string;
  pick: (match: RegExpExecArray) => Record<string, string>;
}> = [
  {
    re: /^Recording is not ready yet \(status: ([\s\S]+)\)$/,
    key: 'Recording is not ready yet (status: {status})',
    pick: (match) => ({ status: match[1] ?? '' }),
  },
  {
    re: /^OpenAI returned (\d+): ([\s\S]*)$/,
    key: 'OpenAI returned {status}: {detail}',
    pick: (match) => ({ status: match[1] ?? '', detail: match[2] ?? '' }),
  },
  {
    re: /^The Free plan includes (\d+) AI summaries per month\. Upgrade for unlimited summaries\.$/,
    key: 'The Free plan includes {n} AI summaries per month. Upgrade for unlimited summaries.',
    pick: (match) => ({ n: match[1] ?? '' }),
  },
  {
    re: /^Google sign-in failed: ([\s\S]+)$/,
    key: 'Google sign-in failed: {detail}',
    pick: (match) => ({ detail: match[1] ?? '' }),
  },
];

const store = new AsyncLocalStorage<ApiLocale>();

/**
 * localeFromRequest — 从 cookie 读取界面语言，没有时再看 Accept-Language
 */
export function localeFromRequest(req: Request): ApiLocale {
  const header = req.headers.get('cookie') ?? '';
  const match = header.match(/(?:^|;\s*)kloud-locale=(en|zh|ja|ko)(?:;|$)/);
  if (match?.[1] === 'en' || match?.[1] === 'zh' || match?.[1] === 'ja' || match?.[1] === 'ko') {
    return match[1];
  }
  const first = (req.headers.get('accept-language') ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
  if (first.startsWith('zh')) return 'zh';
  if (first.startsWith('ja')) return 'ja';
  if (first.startsWith('ko')) return 'ko';
  return 'en';
}

/**
 * runWithLocale — 让这次请求里的 apiJson / apiText 使用当前界面语言
 */
export function runWithLocale<T>(req: Request, fn: () => T): T {
  return store.run(localeFromRequest(req), fn);
}

function rowOf(key: string): Row | undefined {
  if (!Object.prototype.hasOwnProperty.call(catalog, key)) return undefined;
  return catalog[key as keyof typeof catalog];
}

function fill(text: string, params: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? `{${name}}`);
}

/**
 * translateText — 把一条英文展示文案换成指定语言；没有译文时保持英文
 */
export function translateText(locale: ApiLocale, text: string): string {
  if (locale === 'en' || KEEP.has(text)) return text;
  const direct = rowOf(text);
  if (direct) return direct[locale];
  for (const pattern of patterns) {
    const match = pattern.re.exec(text);
    if (!match) continue;
    const row = rowOf(pattern.key);
    if (!row) return text;
    return fill(row[locale], pattern.pick(match));
  }
  return text;
}

/** apiLine — 按当前请求的语言翻译一句展示文案 */
export function apiLine(text: string): string {
  return translateText(store.getStore() ?? 'en', text);
}

/**
 * apiJson — 与 NextResponse.json 相同，但翻译顶层 error / message 展示文案
 */
export function apiJson(body: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(localize(body), init);
}

/** apiText — 纯文本响应里的展示文案 */
export function apiText(text: string, init?: ResponseInit): NextResponse {
  return new NextResponse(apiLine(text), init);
}

function localize(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const src = body as Record<string, unknown>;
  const error = typeof src.error === 'string' ? translateText(store.getStore() ?? 'en', src.error) : src.error;
  const message = typeof src.message === 'string' ? translateText(store.getStore() ?? 'en', src.message) : src.message;
  if (error === src.error && message === src.message) return body;
  const out: Record<string, unknown> = { ...src };
  if (typeof src.error === 'string') out.error = error;
  if (typeof src.message === 'string') out.message = message;
  return out;
}
