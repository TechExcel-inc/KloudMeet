import { NextRequest, NextResponse } from 'next/server';
import {
  fetchReleaseManifest,
  findMacInstaller,
  findWindowsInstaller,
  releaseFileUrl,
} from '@/lib/desktopReleaseManifest';

/** Relative on purpose: behind the site's proxy request.url is the local server's own address. */
function toDownloadPage(): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: '/download' } });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const os = params.get('os') === 'mac' ? 'mac' : 'win';
  const manifest = await fetchReleaseManifest(os);
  if (!manifest) return toDownloadPage();

  const file =
    os === 'mac'
      ? findMacInstaller(manifest, params.get('arch') === 'x64' ? 'x64' : 'arm64')
      : findWindowsInstaller(manifest);
  if (!file) return toDownloadPage();

  // 重定向到实际的安装包
  return NextResponse.redirect(releaseFileUrl(file.url), {
    headers: {
      'X-Release-Version': manifest.version,
      'X-Release-File': file.url,
    },
  });
}
