/**
 * GET /api/transcripts/realtime-token
 *
 * Server-side proxy: 用服务端的 ASSEMBLYAI_API_KEY 向 AssemblyAI V3 换取
 * 一个短期 token（expires_in_seconds 最大 600s），避免将 API Key 暴露给浏览器。
 *
 * AssemblyAI v3 temporary token API:
 *   GET https://streaming.assemblyai.com/v3/token?expires_in_seconds=60
 *   Authorization: <apiKey>
 *   → { token: "..." }
 *
 * 客户端拿到 token 后，连接：
 *   wss://streaming.assemblyai.com/v3/ws?speech_model=u3-rt-pro&sample_rate=16000&token={token}
 */
import { NextResponse } from 'next/server';

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY || '';

export async function GET() {
  if (!ASSEMBLYAI_API_KEY) {
    return NextResponse.json(
      { error: 'AssemblyAI API key not configured' },
      { status: 500 }
    );
  }

  try {
    // v3 token endpoint (GET, not POST)
    const res = await fetch(
      'https://streaming.assemblyai.com/v3/token?expires_in_seconds=120',
      {
        method: 'GET',
        headers: {
          Authorization: ASSEMBLYAI_API_KEY,
        },
      }
    );

    if (!res.ok) {
      const text = await res.text();
      console.error('[realtime-token] AssemblyAI v3 error:', res.status, text);
      return NextResponse.json(
        { error: `AssemblyAI returned ${res.status}: ${text}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json({ token: data.token });
  } catch (err) {
    console.error('[realtime-token]', err);
    return NextResponse.json({ error: 'Failed to get token' }, { status: 500 });
  }
}
