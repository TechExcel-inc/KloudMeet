import { NextRequest, NextResponse } from 'next/server';

const RELEASES_BASE = 'https://kloud.cn/kloudmeet-exe';

/** electron-builder 的更新清单：Windows 为 latest.yml，macOS 为 latest-mac.yml */
const MANIFEST_BY_OS: Record<string, string> = {
  win: 'latest.yml',
  mac: 'latest-mac.yml',
};

export async function GET(request: NextRequest) {
  try {
    const os = request.nextUrl.searchParams.get('os') === 'mac' ? 'mac' : 'win';
    const manifest = MANIFEST_BY_OS[os];

    // 读取对应平台的清单拿到最新版本的文件名
    const res = await fetch(`${RELEASES_BASE}/${manifest}`, {
      next: { revalidate: 60 }, // 缓存 60 秒
    });

    const text = res.ok ? await res.text() : '';
    // 清单不存在时下载站会回落到 SPA 首页（HTML 200），不能当成清单解析
    if (!res.ok || !/^version:/m.test(text)) {
      return NextResponse.json(
        { error: os === 'mac' ? 'macOS version is not available yet' : `Failed to fetch ${manifest}` },
        { status: os === 'mac' ? 404 : 502 },
      );
    }

    // 解析 latest.yml，拿到 path 字段（即安装包文件名）
    const pathMatch = text.match(/^path:\s*(.+)$/m);
    const versionMatch = text.match(/^version:\s*(.+)$/m);

    if (!pathMatch) {
      return NextResponse.json({ error: 'Cannot parse latest.yml' }, { status: 500 });
    }

    const fileName = pathMatch[1].trim();
    const version = versionMatch ? versionMatch[1].trim() : 'latest';
    const downloadUrl = `${RELEASES_BASE}/${encodeURIComponent(fileName)}`;

    // 重定向到实际的安装包
    return NextResponse.redirect(downloadUrl, {
      headers: {
        'X-Release-Version': version,
        'X-Release-File': fileName,
      },
    });
  } catch (err) {
    console.error('[download] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
