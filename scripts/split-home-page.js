const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, '../app/page.tsx');
const lines = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/);
const homeDir = path.join(__dirname, '../app/home');

const sharedImports = `'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { generateRoomId } from '@/lib/client-utils';
import { ScheduleMeetingModal } from '@/lib/ScheduleMeetingModal';
import { SystemSettingsModal } from '@/lib/SystemSettingsModal';
import { MyProfileModal } from '@/lib/MyProfileModal';
import { useI18n, LOCALE_OPTIONS, type Locale } from '@/lib/i18n';
import { HelpModal } from '@/lib/HelpModal';
import { useDesktopAppLaunch } from '@/lib/useDesktopAppLaunch';
import { handleKloudSessionExpired } from '@/lib/handleKloudSessionExpired';
import { authFetch, authHeaders } from '@/lib/kloudSession';
import styles from '../../styles/Home.module.css';
import type { AuthUser, PageView, SignupStep } from './types';
import { KloudLogo } from './components/KloudLogo';
import { useToast } from './components/useToast';
import { TopToolbar } from './components/TopToolbar';
`;

fs.mkdirSync(path.join(homeDir, 'components'), { recursive: true });
fs.mkdirSync(path.join(homeDir, 'views'), { recursive: true });

// types.ts
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

// KloudLogo
fs.writeFileSync(
  path.join(homeDir, 'components/KloudLogo.tsx'),
  `'use client';

import React from 'react';
import styles from '../../../styles/Home.module.css';

${lines.slice(41, 56).join('\n').replace('function KloudLogo', 'export function KloudLogo')}
`,
);

// useToast
fs.writeFileSync(
  path.join(homeDir, 'components/useToast.tsx'),
  `'use client';

import { useState } from 'react';
import styles from '../../../styles/Home.module.css';

${lines.slice(60, 68).join('\n').replace('function useToast', 'export function useToast')}
`,
);

// TopToolbar - needs KloudLogo import
const topToolbarBody = lines.slice(73, 285).join('\n');
fs.writeFileSync(
  path.join(homeDir, 'components/TopToolbar.tsx'),
  `'use client';

import React, { useState } from 'react';
import { useI18n, LOCALE_OPTIONS } from '@/lib/i18n';
import styles from '../../../styles/Home.module.css';
import type { AuthUser } from '../types';
import { KloudLogo } from './KloudLogo';

${topToolbarBody.replace('function TopToolbar', 'export function TopToolbar')}
`,
);

function writeView(name, startLine, endLine, extraImports = '') {
  const body = lines.slice(startLine - 1, endLine).join('\n');
  fs.writeFileSync(
    path.join(homeDir, `views/${name}.tsx`),
    `'use client';

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
${extraImports}

${body.replace(`function ${name}`, `export function ${name}`)}
`,
  );
}

writeView('AnonymousView', 287, 583);
writeView('LoginView', 584, 767);
writeView('SignupView', 768, 1138);
writeView('DashboardView', 1139, 2292);
writeView('ForgotPasswordView', 2293, 2505);

// HomeContent
const homeContentBody = lines.slice(2505, 2692).join('\n');
fs.writeFileSync(
  path.join(homeDir, 'HomeContent.tsx'),
  `${sharedImports}
import { AnonymousView } from './views/AnonymousView';
import { LoginView } from './views/LoginView';
import { SignupView } from './views/SignupView';
import { DashboardView } from './views/DashboardView';
import { ForgotPasswordView } from './views/ForgotPasswordView';

${homeContentBody.replace('function HomeContent', 'export function HomeContent')}
`,
);

// page.tsx
fs.writeFileSync(
  srcPath,
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

console.log('Home page split done');
