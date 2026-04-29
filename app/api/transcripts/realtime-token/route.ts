/**
 * GET /api/transcripts/realtime-token?lang=zh
 *
 * 用服务端 OPENAI_API_KEY 向 OpenAI GA Realtime 创建 transcription Session，
 * 完整 session 配置（model / language / VAD）一次性写在这里，
 * 浏览器拿到 ek_xxx 直接连 WS 即可，无需再发 session.update。
 */
import { NextRequest, NextResponse } from 'next/server';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

export async function GET(req: NextRequest) {
  if (!OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'OpenAI API key not configured' },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(req.url);
  const langRaw = (searchParams.get('lang') || '').trim().toLowerCase();
  const lang = langRaw && langRaw !== 'auto' ? langRaw : '';

  const transcription: Record<string, string> = { model: 'gpt-4o-transcribe' };
  if (lang) transcription.language = lang;

  try {
    const res = await fetch(
      'https://api.openai.com/v1/realtime/client_secrets',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expires_after: { anchor: 'created_at', seconds: 120 },
          session: {
            type: 'transcription',
            audio: {
              input: {
                format: { type: 'audio/pcm', rate: 24000 },
                noise_reduction: { type: 'near_field' },
                transcription,
                turn_detection: {
                  type: 'server_vad',
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 500,
                },
              },
            },
          },
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `OpenAI returned ${res.status}: ${text}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const token: string = data?.value ?? '';
    if (!token) {
      return NextResponse.json({ error: 'No client secret returned' }, { status: 502 });
    }
    return NextResponse.json({ token });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to get token' }, { status: 500 });
  }
}
