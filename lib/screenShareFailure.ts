export type ScreenShareFailureKind =
  | 'systemPermission'
  | 'userGesture'
  | 'insecure'
  | 'policy'
  | 'unsupported'
  | 'notReadable'
  | 'notFound'
  | 'overconstrained'
  | 'inactive'
  | 'disconnected'
  | 'unknown';

export interface ScreenShareFailure {
  kind: ScreenShareFailureKind;
  /** 未能归类时的短原文；已归类时为空 */
  detail: string;
}

function nestedError(error: Error): Error | null {
  const bag: object = error;
  if (!('cause' in bag)) return null;
  return bag.cause instanceof Error ? bag.cause : null;
}

function readError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    const cause = nestedError(error);
    return {
      name: (cause?.name || error.name || '').trim(),
      message: `${error.message || ''} ${cause?.message || ''}`.trim(),
    };
  }
  if (typeof error === 'string') return { name: '', message: error.trim() };
  return { name: '', message: '' };
}

/** 关掉系统选择器、或明确拒绝本次权限。系统级拒绝不在此列。 */
function isUserDismiss(name: string, message: string): boolean {
  const n = name.toLowerCase();
  const m = message.toLowerCase();
  const named = n === 'notallowederror' || n === 'aborterror' || m.includes('notallowederror') || m.includes('aborterror');
  const permissionDenied = m === 'permission denied' || m.endsWith(': permission denied');
  if (!named && !permissionDenied) return false;
  if (
    m.includes('by system') ||
    m.includes('system denied') ||
    m.includes('screen recording') ||
    m.includes('user gesture') ||
    m.includes('permissions-policy') ||
    m.includes('permissions policy') ||
    m.includes('display-capture') ||
    m.includes('secure context') ||
    m.includes('insecure') ||
    m.includes('not fully active')
  ) {
    return false;
  }
  return true;
}

function kindOf(name: string, message: string): ScreenShareFailureKind {
  const n = name.toLowerCase();
  const m = message.toLowerCase();
  if (m.includes('by system') || m.includes('system denied') || m.includes('screen recording')) {
    return 'systemPermission';
  }
  if (m.includes('user gesture')) return 'userGesture';
  if (n === 'securityerror' || m.includes('secure context') || m.includes('insecure')) return 'insecure';
  if (m.includes('permissions-policy') || m.includes('permissions policy') || m.includes('display-capture')) {
    return 'policy';
  }
  if (n === 'notreadableerror' || m.includes('could not start') || m.includes('not readable') || m.includes('device in use')) {
    return 'notReadable';
  }
  if (n === 'notfounderror' || m.includes('requested device') || m.includes('no screen') || m.includes('no window')) {
    return 'notFound';
  }
  if (
    n === 'overconstrainederror' ||
    n === 'constrainterror' ||
    m.includes('overconstrained') ||
    m.includes('systemaudio') ||
    m.includes('system audio') ||
    (n === 'typeerror' && (m.includes('audio') || m.includes('constraint')))
  ) {
    return 'overconstrained';
  }
  if (n === 'invalidstateerror' || m.includes('not fully active')) return 'inactive';
  if (
    n === 'deviceunsupportederror' ||
    n === 'notsupportederror' ||
    m.includes('not supported') ||
    m.includes('not implemented')
  ) {
    return 'unsupported';
  }
  if (
    m.includes('pc manager is closed') ||
    m.includes('unexpectedconnectionstate') ||
    m.includes('not connected') ||
    m.includes('engine is closed')
  ) {
    return 'disconnected';
  }
  return 'unknown';
}

function clip(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (!one) return '';
  return one.length > 96 ? `${one.slice(0, 93)}…` : one;
}

/**
 * classifyScreenShareFailure — 区分用户取消与真正的屏幕共享失败。
 *
 * @param error  setScreenShareEnabled / getDisplayMedia 抛出的错误
 * @returns 用户关掉选择器或拒绝本次权限时为 null，否则为可展示的原因
 */
export function classifyScreenShareFailure(error: unknown): ScreenShareFailure | null {
  const parsed = readError(error);
  if (isUserDismiss(parsed.name, parsed.message)) return null;
  const kind = kindOf(parsed.name, parsed.message);
  return { kind, detail: kind === 'unknown' ? clip(parsed.message || parsed.name) : '' };
}
