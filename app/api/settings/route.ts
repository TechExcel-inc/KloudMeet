import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// All setting keys managed by the System Settings modal
const SETTING_KEYS = [
  'org_name',
  'livedoc_debug_enabled',
  'livedoc_debug_url',
  'aws_access_key',
  'aws_secret_key',
  'aws_region',
  'aws_bucket',
  'livekit_url',
  'livekit_api_key',
  'livekit_api_secret',
  'telnyx_app_key',
];
const SETTINGS_FALLBACK_FILE = path.join(process.cwd(), 'tmp', 'system-settings.json');

async function ensureSystemSettingTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`SystemSetting\` (
      \`id\` INT NOT NULL AUTO_INCREMENT,
      \`key\` VARCHAR(191) NOT NULL,
      \`value\` LONGTEXT NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`modifiedAt\` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`SystemSetting_key_key\` (\`key\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);
}

function normalizeSettings(input: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const key of SETTING_KEYS) {
    if (key in input) normalized[key] = String(input[key] ?? '');
  }
  return normalized;
}

async function readFallbackSettings(): Promise<Record<string, string>> {
  try {
    const text = await fs.readFile(SETTINGS_FALLBACK_FILE, 'utf8');
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return normalizeSettings(parsed);
  } catch {
    return {};
  }
}

async function writeFallbackSettings(nextSettings: Record<string, string>): Promise<void> {
  await fs.mkdir(path.dirname(SETTINGS_FALLBACK_FILE), { recursive: true });
  await fs.writeFile(
    SETTINGS_FALLBACK_FILE,
    JSON.stringify(nextSettings, null, 2),
    'utf8',
  );
}

// GET /api/settings — Load all system settings
export async function GET() {
  try {
    await ensureSystemSettingTable();
    const keys = Prisma.join(SETTING_KEYS.map((key) => Prisma.sql`${key}`));
    const rows = await prisma.$queryRaw<Array<{ key: string; value: string }>>(
      Prisma.sql`SELECT \`key\`, \`value\` FROM \`SystemSetting\` WHERE \`key\` IN (${keys})`,
    );

    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }

    return NextResponse.json(settings);
  } catch (error) {
    console.error('[settings GET]', error);
    const fallback = await readFallbackSettings();
    return NextResponse.json(fallback);
  }
}

// PUT /api/settings — Upsert system settings
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const entries = Object.entries(body).filter(
    ([key]) => SETTING_KEYS.includes(key),
  );

  try {
    await ensureSystemSettingTable();

    // Upsert each key-value pair
    await Promise.all(
      entries.map(([key, value]) =>
        prisma.$executeRaw(
          Prisma.sql`
            INSERT INTO \`SystemSetting\` (\`key\`, \`value\`)
            VALUES (${key}, ${String(value ?? '')})
            ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)
          `,
        ),
      ),
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[settings PUT]', error);
    const previous = await readFallbackSettings();
    const merged = { ...previous };
    for (const [key, value] of entries) {
      merged[key] = String(value ?? '');
    }
    await writeFallbackSettings(merged);
    return NextResponse.json({ ok: true, storage: 'fallback-file' });
  }
}
