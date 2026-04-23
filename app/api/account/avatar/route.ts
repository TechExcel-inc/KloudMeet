import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  region: process.env.S3_REGION || 'us-west-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET!,
  },
});

async function getAuthMember(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  const session = await prisma.session.findUnique({
    where: { token },
    include: { teamMember: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.teamMember;
}

export async function POST(request: NextRequest) {
  try {
    const member = await getAuthMember(request);
    if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image files are allowed' }, { status: 400 });
    }

    // Validate size (2MB)
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size must be less than 2MB' }, { status: 400 });
    }

    // Generate unique S3 key
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const key = `avatars/${member.id}_${Date.now()}.${ext}`;

    // Upload to S3
    const buffer = Buffer.from(await file.arrayBuffer());
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: key,
      Body: buffer,
      ContentType: file.type,
      // Public read so avatars are accessible without signed URLs
      ACL: 'public-read',
    }));

    // Build public URL
    const region = process.env.S3_REGION || 'us-west-1';
    const bucket = process.env.S3_BUCKET!;
    const avatarUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

    // Save URL to database
    await prisma.teamMember.update({
      where: { id: member.id },
      data: {
        avatarUrl,
        modifiedAt: new Date(),
        modifiedBy: 'avatar-upload',
      },
    });

    return NextResponse.json({ avatarUrl });
  } catch (error) {
    console.error('[avatar-upload]', error);
    return NextResponse.json({ error: 'Failed to upload avatar' }, { status: 500 });
  }
}
