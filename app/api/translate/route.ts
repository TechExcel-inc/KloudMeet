import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { verifyParticipant } from '@/lib/livekitParticipantAuth';

const WebOTS_URL = "https://ntrans.xfyun.cn/v2/ots";
const APPID = process.env.XFYUN_APPID || '';
const API_SECRET = process.env.XFYUN_API_SECRET || '';
const API_KEY = process.env.XFYUN_API_KEY || '';

/**
 * Helper to sign the body using SHA-256.
 */
function signBody(body: string): string {
    return crypto.createHash('sha256').update(body).digest('base64');
}

/**
 * Helper to sign the signature string using HMAC-SHA256.
 */
function hmacSign(message: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(message).digest('base64');
}

export async function POST(request: NextRequest) {
    if (!(await verifyParticipant(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!APPID || !API_SECRET || !API_KEY) {
        return NextResponse.json({ error: 'Translation is not configured' }, { status: 500 });
    }

    try {
        const bodyData = await request.json();
        const { text, from, to } = bodyData;

        if (!text || !text.trim()) {
            return NextResponse.json({ translatedText: '' });
        }

        // 1. Build HTTP Body
        const bodyObj = {
            common: { app_id: APPID },
            business: { from, to },
            data: { text: Buffer.from(text).toString('base64') }
        };
        const body = JSON.stringify(bodyObj);

        // 2. Build HTTP Headers (Signing)
        const date = new Date().toUTCString();
        const digestBase64 = "SHA-256=" + signBody(body);
        const url = new URL(WebOTS_URL);
        const host = url.host;
        
        const signatureOrigin = `host: ${host}\ndate: ${date}\nPOST ${url.pathname} HTTP/1.1\ndigest: ${digestBase64}`;
        const sha = hmacSign(signatureOrigin, API_SECRET);
        
        const authorization = `api_key="${API_KEY}", algorithm="hmac-sha256", headers="host date request-line digest", signature="${sha}"`;

        const response = await fetch(WebOTS_URL, {
            method: 'POST',
            headers: {
                'Authorization': authorization,
                'Content-Type': 'application/json',
                'Accept': 'application/json,version=1.0',
                'Host': host,
                'Date': date,
                'Digest': digestBase64
            },
            body
        });

        const result = await response.json();

        if (result.code === 0 && result.data && result.data.result) {
            return NextResponse.json({ 
                translatedText: result.data.result.trans_result.dst,
                code: 0 
            });
        }

        return NextResponse.json({ 
            error: result.message || 'Xunfei API error',
            code: result.code 
        }, { status: 500 });

    } catch (error: any) {
        console.error('[Translation API Proxy Error]:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
