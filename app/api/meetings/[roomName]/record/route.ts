import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { EgressClient, EncodedFileType, EncodedFileOutput } from 'livekit-server-sdk';

const LIVEKIT_URL = process.env.LIVEKIT_URL;
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;

const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY;
const S3_SECRET = process.env.S3_SECRET;
const S3_REGION = process.env.S3_REGION;
const S3_BUCKET = process.env.S3_BUCKET;
const S3_ENDPOINT = process.env.S3_ENDPOINT;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomName: string }> }
) {
  try {
    const resolvedParams = await params;
    const roomName = resolvedParams?.roomName;
    if (!roomName) {
      return NextResponse.json({ error: 'Room name not provided' }, { status: 400 });
    }

    const body = await request.json();
    const { teamMemberId, action, pageUrl } = body;

    if (!teamMemberId) {
      return NextResponse.json({ error: 'teamMemberId is required' }, { status: 401 });
    }

    const meeting = await prisma.meeting.findUnique({ where: { roomName } });
    if (!meeting) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    if (!LIVEKIT_URL || !API_KEY || !API_SECRET) {
      return NextResponse.json({ error: 'LiveKit configuration missing' }, { status: 500 });
    }

    const egressClient = new EgressClient(LIVEKIT_URL, API_KEY, API_SECRET);

    if (action === 'stop') {
      const activeRecordings = await prisma.recording.findMany({
        where: { meetingId: meeting.id, status: 'PROCESSING' }
      });
      if (activeRecordings.length === 0) {
        return NextResponse.json({ error: 'No active recording found' }, { status: 404 });
      }
      
      // Stop all active egresses for this meeting
      for (const rec of activeRecordings) {
        // We stored egressId in storageKey temporarily
        try {
          await egressClient.stopEgress(rec.storageKey);
        } catch (e) {
          console.error('Failed to stop egress', rec.storageKey, e);
        }
      }
      
      return NextResponse.json({ success: true, message: 'Stopping recording' });
    }

    // Otherwise, START recording
    if (!S3_ACCESS_KEY || !S3_SECRET || !S3_REGION || !S3_BUCKET) {
      console.error('S3 configuration is missing in .env');
      return NextResponse.json({ error: 'Cloud storage (S3/OSS) configuration is missing in environment variables. LiveKit Cloud requires a cloud storage destination for recordings.' }, { status: 500 });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filepath = `recordings/${roomName}-${timestamp}.mp4`;

    let fileOutput: EncodedFileOutput;
    
    // Check if it's AliOSS or S3 based on endpoint or explicit variable
    if (S3_ENDPOINT && S3_ENDPOINT.includes('aliyuncs.com')) {
      fileOutput = new EncodedFileOutput({
        fileType: EncodedFileType.MP4,
        filepath,
        output: {
          case: 'aliOSS',
          value: {
            accessKey: S3_ACCESS_KEY,
            secret: S3_SECRET,
            region: S3_REGION,
            bucket: S3_BUCKET,
            endpoint: S3_ENDPOINT,
          }
        }
      });
    } else {
      fileOutput = new EncodedFileOutput({
        fileType: EncodedFileType.MP4,
        filepath,
        output: {
          case: 's3',
          value: {
            accessKey: S3_ACCESS_KEY,
            secret: S3_SECRET,
            region: S3_REGION,
            bucket: S3_BUCKET,
            endpoint: S3_ENDPOINT || '',
          }
        }
      });
    }

    if (!pageUrl) {
      return NextResponse.json({ error: 'pageUrl is required for Web Egress' }, { status: 400 });
    }

    // Use startWebEgress so that LiveKit runs a headless browser to record exactly what's on the screen
    // Adding ?isBot=true so the frontend component skips the PreJoin waiting room
    const parsedUrl = new URL(pageUrl);
    parsedUrl.searchParams.set('isBot', 'true');
    const targetUrl = parsedUrl.toString();

    const info = await egressClient.startWebEgress(
      targetUrl,
      fileOutput, // The new standard requires passing the output definition object natively here
      {
        audioOnly: false,
        videoOnly: false,
      }
    );

    // Create tracking record
    const recording = await prisma.recording.create({
      data: {
        meetingId: meeting.id,
        teamMemberId: teamMemberId,
        fileName: `${roomName}-${timestamp}.mp4`,
        storageProvider: S3_ENDPOINT?.includes('aliyuncs') ? 'ALI_OSS' : 'S3',
        storageKey: info.egressId, // Temporarily store egressId here
        status: 'PROCESSING',
      }
    });

    return NextResponse.json({ success: true, recording, egressId: info.egressId });
  } catch (error: any) {
    console.error('[meetings record POST]', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
