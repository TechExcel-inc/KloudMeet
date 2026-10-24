import { NextRequest, NextResponse } from 'next/server';

const RELEASES_BASE = 'https://kloud.cn/kloudmeet-exe';

/** electron-builder 的更新清单：Windows 为 latest.yml，macOS 为 latest-mac.yml */
const MANIFEST_BY_OS: Record<string, string> = {
  win: 'latest.yml',
  mac: 'latest-mac.yml',
};

/** Shown when the macOS button is used before a Mac build has been published. */
function macComingSoonPage(): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KloudMeet for Mac</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f5fa;color:#1f1f1f}main{max-width:420px;padding:32px;text-align:center}h1{font-size:22px;margin:0 0 8px}p{margin:0 0 20px;color:#5f6368;line-height:1.5}a{color:#5e5ce6;font-weight:600;text-decoration:none}</style></head>
<body><main><h1>KloudMeet for Mac is coming soon</h1><p>The macOS app isn't published yet. You can join any meeting from your browser in the meantime.</p><a href="/">Back to KloudMeet</a></main></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

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
      if (os === 'mac') return macComingSoonPage();
      return NextResponse.json({ error: `Failed to fetch ${manifest}` }, { status: 502 });
    }

    // 解析 latest.yml，拿到 path 字段（即安装包文件名）
    const pathMatch = text.match(/^path:\s*(.+)$/m);
    const versionMatch = text.match(/^version:\s*(.+)$/m);

    if (!pathMatch) {
      return NextResponse.json({ error: 'Cannot parse latest.yml' }, { status: 500 });
    }

    // macOS 按芯片分别打包（内置服务带原生模块，无法做 universal）：?arch=arm64|x64 选对应的 dmg
    let fileName = pathMatch[1].trim();
    if (os === 'mac') {
      const arch = request.nextUrl.searchParams.get('arch') === 'x64' ? 'x64' : 'arm64';
      const dmgs = [...text.matchAll(/^\s*-\s*url:\s*(.+\.dmg)\s*$/gm)].map((m) => m[1].trim());
      const match = dmgs.find((f) => f.includes(`-${arch}.`)) ?? dmgs[0];
      if (match) fileName = match;
    }
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
