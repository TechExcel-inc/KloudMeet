/**
 * Reads electron-builder's update manifests (latest.yml for Windows, latest-mac.yml for macOS) on the
 * download server: what /download shows and where /api/download sends people.
 */
export const RELEASES_BASE = process.env.KLOUDMEET_RELEASES_BASE || 'https://kloud.cn/kloudmeet-exe';

const MANIFEST_BY_OS = { win: 'latest.yml', mac: 'latest-mac.yml' } as const;

export type DesktopOs = keyof typeof MANIFEST_BY_OS;
export type MacArch = 'arm64' | 'x64';

export interface ReleaseFile {
  url: string;
  size: number | null;
}

export interface ReleaseManifest {
  version: string;
  releaseDate: string | null;
  path: string | null;
  files: ReleaseFile[];
}

export function parseReleaseManifest(text: string): ReleaseManifest | null {
  // 清单不存在时下载站会回落到 SPA 首页（HTML 200），不能当成清单解析
  const version = text.match(/^version:\s*(.+)$/m)?.[1].trim();
  if (!version) return null;

  const files: ReleaseFile[] = [];
  for (const line of text.split(/\r?\n/)) {
    const url = line.match(/^\s*-\s*url:\s*(.+)$/)?.[1].trim();
    if (url) {
      files.push({ url, size: null });
      continue;
    }
    const size = line.match(/^\s+size:\s*(\d+)\s*$/)?.[1];
    if (size && files.length > 0) files[files.length - 1].size = Number(size);
  }

  return {
    version,
    releaseDate: text.match(/^releaseDate:\s*'?([^'\n]+)'?\s*$/m)?.[1].trim() ?? null,
    path: text.match(/^path:\s*(.+)$/m)?.[1].trim() ?? null,
    files,
  };
}

/** macOS 按芯片分别打包（内置服务带原生模块，无法做 universal），所以一定要拿到对应芯片的 dmg */
export function findMacDmg(manifest: ReleaseManifest, arch: MacArch): ReleaseFile | null {
  return manifest.files.find((f) => f.url.endsWith('.dmg') && f.url.includes(`-${arch}.`)) ?? null;
}

export function findWindowsInstaller(manifest: ReleaseManifest): ReleaseFile | null {
  return (
    manifest.files.find((f) => f.url.endsWith('.exe')) ??
    (manifest.path ? { url: manifest.path, size: null } : null)
  );
}

export function releaseFileUrl(fileName: string): string {
  return `${RELEASES_BASE}/${encodeURIComponent(fileName)}`;
}

/** The published release for an OS, or null when none is published or the server can't be reached. */
export async function fetchReleaseManifest(os: DesktopOs): Promise<ReleaseManifest | null> {
  try {
    const res = await fetch(`${RELEASES_BASE}/${MANIFEST_BY_OS[os]}`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? parseReleaseManifest(await res.text()) : null;
  } catch (err) {
    console.error(`[download] ${os} manifest:`, err);
    return null;
  }
}
