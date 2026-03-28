import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { WebhookReceiver } from 'livekit-server-sdk';

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;

const receiver = new WebhookReceiver(API_KEY || '', API_SECRET || '');

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const authHeader = request.headers.get('Authorization');

    if (!authHeader) {
      return NextResponse.json({ error: 'Missing authorization header' }, { status: 401 });
    }

    let event;
    try {
      // livekit-server-sdk receiver verifies the signature and parses the event payload
      event = await receiver.receive(body, authHeader, true);
    } catch (err: any) {
      console.error('[webhooks livekit] signature validation failed', err);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    console.log(`[webhooks livekit] Received event: ${event.event}`);

    if (event.event === 'egress_ended' && event.egressInfo) {
      const egressId = event.egressInfo.egressId;
      const fileInfo = event.egressInfo.fileResults?.[0] || (event.egressInfo.result?.case === 'file' ? event.egressInfo.result.value : null);
      const error = event.egressInfo.error;

      // Find the recording by egressId which we stored in storageKey temporarily
      const recording = await prisma.recording.findFirst({
        where: { storageKey: egressId }
      });

      if (recording) {
        if (error) {
          await prisma.recording.update({
            where: { id: recording.id },
            data: { status: 'FAILED' }
          });
        } else if (fileInfo) {
          await prisma.recording.update({
            where: { id: recording.id },
            data: {
              status: 'READY',
              storageKey: fileInfo.filename || egressId, // Real Object Key
              storageUrl: fileInfo.location, // Public URL if the bucket is configured as such
              fileSizeBytes: fileInfo.size ? Number(fileInfo.size) : null,
              durationSeconds: fileInfo.duration ? Math.floor(Number(fileInfo.duration) / 1000000000) : null,
            }
          });
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[webhooks livekit POST]', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
