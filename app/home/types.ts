export type PageView = 'anonymous' | 'login' | 'signup' | 'dashboard' | 'forgot-password';
export type SignupStep = 'email' | 'verify' | 'create';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  token: string;
}
