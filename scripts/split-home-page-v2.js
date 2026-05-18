const fs = require('fs');
const path = require('path');

const { execSync } = require('child_process');
const repoRoot = path.join(__dirname, '..');
const pageSource = fs.existsSync(path.join(repoRoot, 'app/page.full.tsx'))
  ? fs.readFileSync(path.join(repoRoot, 'app/page.full.tsx'), 'utf8')
  : execSync('git show HEAD:app/page.tsx', { cwd: repoRoot, encoding: 'utf8' });
const lines = pageSource.split(/\r?\n/);
const homeDir = path.join(__dirname, '../app/home');

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

ensureDir(path.join(homeDir, 'components'));
ensureDir(path.join(homeDir, 'views'));

fs.writeFileSync(
  path.join(homeDir, 'types.ts'),
  `export type PageView = 'anonymous' | 'login' | 'signup' | 'dashboard' | 'forgot-password';
export type SignupStep = 'email' | 'verify' | 'create';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  token: string;
}
`,
);

fs.writeFileSync(
  path.join(homeDir, 'mockData.ts'),
  `'use client';

export ${slice(29, 37).replace(/^const /gm, 'const ')}
`,
);

const componentPreamble = `'use client';

import React from 'react';
import styles from '../../../styles/Home.module.css';

`;

fs.writeFileSync(
  path.join(homeDir, 'components/KloudLogo.tsx'),
  componentPreamble + slice(42, 56).replace(/^function /, 'export function ') + '\n',
);

fs.writeFileSync(
  path.join(homeDir, 'components/useToast.tsx'),
  `'use client';

import { useState } from 'react';
import styles from '../../../styles/Home.module.css';

` + slice(61, 69).replace(/^function /m, 'export function ') + '\n',
);

fs.writeFileSync(
  path.join(homeDir, 'components/TopToolbar.tsx'),
  `'use client';

import React, { useState } from 'react';
import { useI18n, LOCALE_OPTIONS } from '@/lib/i18n';
import styles from '../../../styles/Home.module.css';
import type { AuthUser } from '../types';
import { KloudLogo } from './KloudLogo';

` + slice(74, 283).replace(/^function /, 'export function ') + '\n',
);

const viewImports = `'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { generateRoomId } from '@/lib/client-utils';
import { ScheduleMeetingModal } from '@/lib/ScheduleMeetingModal';
import { SystemSettingsModal } from '@/lib/SystemSettingsModal';
import { MyProfileModal } from '@/lib/MyProfileModal';
import { useI18n } from '@/lib/i18n';
import { HelpModal } from '@/lib/HelpModal';
import { useDesktopAppLaunch } from '@/lib/useDesktopAppLaunch';
import { handleKloudSessionExpired } from '@/lib/handleKloudSessionExpired';
import { authFetch, authHeaders } from '@/lib/kloudSession';
import styles from '../../../styles/Home.module.css';
import type { AuthUser, SignupStep } from '../types';
import { KloudLogo } from '../components/KloudLogo';
import { TopToolbar } from '../components/TopToolbar';
import { MOCK_RECENT, MOCK_SCHEDULED } from '../mockData';

`;

function writeView(name, start, end) {
  const body = slice(start, end).replace(/^function /m, 'export function ');
  fs.writeFileSync(path.join(homeDir, `views/${name}.tsx`), viewImports + body + '\n');
}

writeView('AnonymousView', 287, 580);
writeView('LoginView', 584, 764);
writeView('SignupView', 768, 1135);
writeView('DashboardView', 1139, 2289);
writeView('ForgotPasswordView', 2293, 2502);

const homeImports = `'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { HelpModal } from '@/lib/HelpModal';
import { useDesktopAppLaunch } from '@/lib/useDesktopAppLaunch';
import { handleKloudSessionExpired } from '@/lib/handleKloudSessionExpired';
import styles from '../../styles/Home.module.css';
import type { AuthUser, PageView } from './types';
import { useToast } from './components/useToast';
import { AnonymousView } from './views/AnonymousView';
import { LoginView } from './views/LoginView';
import { SignupView } from './views/SignupView';
import { DashboardView } from './views/DashboardView';
import { ForgotPasswordView } from './views/ForgotPasswordView';

`;

fs.writeFileSync(
  path.join(homeDir, 'HomeContent.tsx'),
  homeImports + slice(2507, 2691).replace(/^function /m, 'export function ') + '\n',
);

fs.writeFileSync(
  path.join(repoRoot, 'app/page.tsx'),
  `'use client';

import React, { Suspense } from 'react';
import styles from '../styles/Home.module.css';
import { HomeContent } from './home/HomeContent';

export default function Page() {
  return (
    <main className={styles.main}>
      <Suspense fallback="Loading">
        <HomeContent />
      </Suspense>
    </main>
  );
}
`,
);

console.log('split v2 ok');
