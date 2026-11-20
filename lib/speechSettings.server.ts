import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';

const CREDENTIAL = 'assemblyai_stt_credential';
const ACTIVE = 'assemblyai_stt_active';

function encryptionKey() {
  const secret = process.env.SPEECH_SETTINGS_SECRET || process.env.LIVEKIT_API_SECRET;
  if (!secret) throw new Error('Speech settings encryption is unavailable');
  return Buffer.from(hkdfSync('sha256', secret, '', 'kloudmeet:speech-settings:v1', 32));
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

function decrypt(value: string) {
  const data = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}

async function storedSettings() {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [CREDENTIAL, ACTIVE] } },
    select: { key: true, value: true },
  }).catch((error: unknown) => {
    // Upgrades may reach transcription before the Account Settings route creates the table.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2021') return [];
    throw error;
  });
  return new Map(rows.map(({ key, value }) => [key, value]));
}

export async function speechSettingsStatus() {
  const settings = await storedSettings();
  return {
    assemblyConfigured: Boolean(settings.get(CREDENTIAL) || process.env.ASSEMBLYAI_API_KEY?.trim()),
    assemblyActive: settings.get(ACTIVE) !== '0',
    aliConfigured: Boolean(process.env.DASHSCOPE_API_KEY?.trim()),
  };
}

export type SpeechSettingsStatus = Awaited<ReturnType<typeof speechSettingsStatus>>;

export async function assemblyAiKey({ existingJob = false } = {}): Promise<string | undefined> {
  const settings = await storedSettings();
  if (!existingJob && settings.get(ACTIVE) === '0') return undefined;
  const credential = settings.get(CREDENTIAL);
  return credential ? decrypt(credential) : process.env.ASSEMBLYAI_API_KEY?.trim() || undefined;
}

export async function saveAssemblyAiSettings(active: boolean, appKey: string) {
  const settings = [[ACTIVE, active ? '1' : '0']];
  if (appKey) settings.push([CREDENTIAL, encrypt(appKey)]);
  await prisma.$transaction(settings.map(([key, value]) => prisma.$executeRaw`
    INSERT INTO \`SystemSetting\` (\`key\`, \`value\`) VALUES (${key}, ${value})
    ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)
  `));
}
