import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

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
    return NextResponse.json(
      { error: 'Failed to load settings' },
      { status: 500 },
    );
  }
}

// PUT /api/settings — Upsert system settings
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const entries = Object.entries(body).filter(([key]) => SETTING_KEYS.includes(key));

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
    return NextResponse.json(
      { error: 'Failed to save settings' },
      { status: 500 },
    );
  }
}
