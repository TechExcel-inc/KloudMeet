import type { NextRequest } from 'next/server';
import { isAuthError, requireInternalStaff } from '@/lib/apiAuth';
import { apiJson, runWithLocale } from '@/lib/apiMsg';
import { saveAssemblyAiSettings, speechSettingsStatus } from '@/lib/speechSettings.server';

const headers = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  return runWithLocale(request, async () => {
    const staff = await requireInternalStaff(request);
    if (isAuthError(staff)) return staff;
    try {
      return apiJson(await speechSettingsStatus(), { headers });
    } catch {
      return apiJson({ error: 'Failed to load speech settings' }, { status: 500, headers });
    }
  });
}

export async function PUT(request: NextRequest) {
  return runWithLocale(request, async () => {
    const staff = await requireInternalStaff(request);
    if (isAuthError(staff)) return staff;

    const body = await request.json().catch(() => null);
    const appKey = typeof body?.appKey === 'string' ? body.appKey.trim() : null;
    if (typeof body?.active !== 'boolean' || appKey === null || !/^[\x21-\x7e]{0,256}$/.test(appKey)) {
      return apiJson({ error: 'Invalid speech settings' }, { status: 400, headers });
    }

    try {
      await saveAssemblyAiSettings(body.active, appKey);
      return apiJson(await speechSettingsStatus(), { headers });
    } catch {
      return apiJson({ error: 'Failed to save speech settings' }, { status: 500, headers });
    }
  });
}
