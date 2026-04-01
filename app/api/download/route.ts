import { NextResponse } from 'next/server';

const RELEASES_BASE = 'https://kloud.cn/kloudmeet-exe';

export async function GET() {
  try {
    // 读取 latest.yml 拿到最新版本的文件名
    const res = await fetch(`${RELEASES_BASE}/latest.yml`, {
      next: { revalidate: 60 }, // 缓存 60 秒
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch latest.yml' }, { status: 502 });
    }

    const text = await res.text();

    // 解析 latest.yml，拿到 path 字段（即安装包文件名）
    const pathMatch = text.match(/^path:\s*(.+)$/m);
    const versionMatch = text.match(/^version:\s*(.+)$/m);

    if (!pathMatch) {
      return NextResponse.json({ error: 'Cannot parse latest.yml' }, { status: 500 });
    }

    const fileName = pathMatch[1].trim();
    const version = versionMatch ? versionMatch[1].trim() : 'latest';
    const downloadUrl = `${RELEASES_BASE}/${encodeURIComponent(fileName)}`;

    // 302 重定向到实际的 exe 文件
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
