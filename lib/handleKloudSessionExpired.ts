const LOCALE_KEY = 'kloud-locale';

const MESSAGES: Record<string, string> = {
  zh:
    '您的登录状态已过期，请重新登录后再继续使用。\n\n点击「确定」将返回首页。',
  en:
    'Your sign-in has expired. Please sign in again to continue.\n\nClick OK to return to the home page.',
  ja:
    'ログインの有効期限が切れています。続けるには再度ログインしてください。\n\n「OK」を押すとトップページに戻ります。',
  ko:
    '로그인 상태가 만료되었습니다. 계속 이용하시려면 다시 로그인해 주세요.\n\n「확인」을 누르면 홈으로 이동합니다.',
};
function getSessionExpiredMessage(): string {
  try {
    const lo = localStorage.getItem(LOCALE_KEY);
    if (lo && MESSAGES[lo]) return MESSAGES[lo];
  } catch {
    /* ignore */
  }
  return MESSAGES.zh;
}

let handling = false;

/**
 * 清除本地登录态，提示用户，并跳转到首页（用于 /api/auth/profile、connection-details 等返回 401 时）。
 */
export function handleKloudSessionExpired(): void {
  if (typeof window === 'undefined') return;
  if (handling) return;
  handling = true;

  try {
    localStorage.removeItem('kloudUser');
    sessionStorage.removeItem('kloudUser');
  } catch {
    /* ignore */
  }

  window.alert(getSessionExpiredMessage());
  window.location.assign('/');
}
