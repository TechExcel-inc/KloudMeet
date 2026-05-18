const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, '../app/rooms/[roomName]/PageClientImpl.tsx');
const lines = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/);

const roomDir = path.dirname(srcPath);

// roomConstants.ts (lines 62-77)
const constants = lines.slice(61, 77).join('\n');
fs.writeFileSync(path.join(roomDir, 'roomConstants.ts'), constants + '\n');

// roomVideoLayouts.tsx (lines 939-1506, 1-based)
const layoutsImports = `'use client';

import React from 'react';
import { Participant, Track } from 'livekit-client';
import {
  ParticipantTile,
  TrackMutedIndicator,
  useIsSpeaking,
  useTracks,
  VideoTrack,
} from '@livekit/components-react';
import { getInitials } from '@/lib/getInitials';
import {
  FLOATING_WEBCAM_BOTTOM_TOOLBAR_INSET,
  FLOATING_WEBCAM_DEFAULT_GAP_FROM_LIVEDOC_PANEL,
  FLOATING_WEBCAM_RIGHT_DRAG_CLAMP_MARGIN,
  FLOATING_WEBCAM_RIGHT_INSET,
  FLOATING_WEBCAM_TOP_INSET,
  LIVEDOC_FILE_PANEL_COLLAPSED_WIDTH,
  LIVEDOC_FILE_PANEL_EXPANDED_WIDTH,
} from './roomConstants';

`;
const layoutsBody = lines.slice(938, 1506).join('\n');
fs.writeFileSync(
  path.join(roomDir, 'roomVideoLayouts.tsx'),
  layoutsImports + layoutsBody + '\n',
);

// VideoConferenceComponent.tsx (lines 1508-end)
const vcImports = `'use client';

${lines.slice(2, 60).join('\n')}
import { calcGridCols, MAX_VISIBLE, MobileVideoLayout } from './roomVideoLayouts';
import { authHeaders } from '@/lib/kloudSession';
import {
  FLOATING_WEBCAM_BOTTOM_TOOLBAR_INSET,
  FLOATING_WEBCAM_DEFAULT_GAP_FROM_LIVEDOC_PANEL,
  FLOATING_WEBCAM_RIGHT_DRAG_CLAMP_MARGIN,
  FLOATING_WEBCAM_RIGHT_INSET,
  FLOATING_WEBCAM_TOP_INSET,
  LIVEDOC_FILE_PANEL_COLLAPSED_WIDTH,
  LIVEDOC_FILE_PANEL_EXPANDED_WIDTH,
  SCREEN_SHARE_CAPTURE,
} from './roomConstants';

`;
const vcBody = lines.slice(1507).join('\n');
fs.writeFileSync(path.join(roomDir, 'VideoConferenceComponent.tsx'), vcImports + vcBody);

// PageClientImpl.tsx (lines 1-933, trimmed)
const mainImports = `'use client';

${lines.slice(2, 60).join('\n')}
import { VideoConferenceComponent } from './VideoConferenceComponent';
import { connectionDetailsFetchInit } from '@/lib/kloudSession';
import {
  FLOATING_WEBCAM_DEFAULT_GAP_FROM_LIVEDOC_PANEL,
  LIVEDOC_FILE_PANEL_COLLAPSED_WIDTH,
  LIVEDOC_FILE_PANEL_EXPANDED_WIDTH,
  SCREEN_SHARE_CAPTURE,
} from './roomConstants';

`;
const mainBody = lines
  .slice(60, 933)
  .filter(
    (l) =>
      !l.includes('function getKloudSessionBearer') &&
      !l.includes('function connectionDetailsFetchInit') &&
      !l.startsWith('const FLOATING_') &&
      !l.startsWith('const LIVEDOC_') &&
      !l.startsWith('const SCREEN_SHARE_CAPTURE') &&
      !l.startsWith('const CONN_DETAILS_ENDPOINT') ||
      l.includes('CONN_DETAILS_ENDPOINT'),
  )
  .join('\n');

// Fix: keep CONN_DETAILS_ENDPOINT, remove duplicate constants block manually
let mainLines = lines.slice(60, 933);
// Remove lines 62-119 equivalent in slice (getKloudSessionBearer through connectionDetailsFetchInit)
mainLines = mainLines.filter((line, i) => {
  const trimmed = line.trim();
  if (trimmed.startsWith('/** LiveDoc 浮窗')) return false;
  if (trimmed.startsWith('const FLOATING_')) return false;
  if (trimmed.startsWith('const LIVEDOC_')) return false;
  if (trimmed.startsWith('const SCREEN_SHARE_CAPTURE')) return false;
  if (trimmed === 'function getKloudSessionBearer()') return false;
  if (trimmed === 'function connectionDetailsFetchInit(overrides?: RequestInit): RequestInit {') return false;
  if (trimmed.startsWith('  const t = getKloudSessionBearer')) return false;
  if (trimmed.startsWith('  const authHeaders:')) return false;
  if (trimmed.startsWith('  const o = overrides')) return false;
  if (trimmed.startsWith('  const mergedHeaders')) return false;
  if (trimmed === '  return { ...o, headers: mergedHeaders };') return false;
  if (trimmed === '}') {
    // might remove wrong braces - handle block differently
  }
  return true;
});

// Simpler: take lines 120-933 (after connectionDetailsFetchInit block ends at 119)
const mainBody2 = lines.slice(119, 933).join('\n');
fs.writeFileSync(path.join(roomDir, 'PageClientImpl.tsx'), mainImports + mainBody2 + '\n');

console.log('Split complete:', {
  constants: 16,
  layouts: 1506 - 938,
  vc: lines.length - 1507,
  main: 933 - 119,
});
