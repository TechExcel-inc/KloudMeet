import { prisma } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

// All setting keys managed by the System Settings modal
const SETTING_KEYS = [
  'org_name',
  'aws_access_key',
  'aws_secret_key',
  'aws_region',
  'aws_bucket',
  'livekit_url',
  'livekit_api_key',
  'livekit_api_secret',
  'telnyx_app_key',
];

// GET /api/settings — Load all system settings
export async function GET() {
  try {
    const rows = await prisma.systemSetting.findMany({
      where: { key: { in: SETTING_KEYS } },
    });

    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }

    return NextResponse.json(settings);
  } catch (error) {
    console.error('[settings GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/settings — Upsert system settings
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    // Only allow known keys
    const entries = Object.entries(body).filter(
      ([key]) => SETTING_KEYS.includes(key),
    );

    // Upsert each key-value pair
    await Promise.all(
      entries.map(([key, value]) =>
        prisma.systemSetting.upsert({
          where: { key },
          create: { key, value: String(value ?? '') },
          update: { value: String(value ?? '') },
        }),
      ),
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[settings PUT]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
