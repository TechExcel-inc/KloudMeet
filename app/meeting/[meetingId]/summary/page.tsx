/**
 * /meeting/[meetingId]/summary
 *
 * 按会议 ID 访问回放页的快捷路由。
 * 查找该会议最新一条 READY 状态的录制，重定向到 /recordings/{id}。
 */
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';

interface Props {
  params: Promise<{ meetingId: string }>;
}

export default async function MeetingSummaryPage({ params }: Props) {
  const { meetingId } = await params;
  const id = parseInt(meetingId);

  if (isNaN(id)) {
    redirect('/');
  }

  // 查找最新一条 READY 录制
  const recording = await prisma.recording.findFirst({
    where: {
      meetingId: id,
      status: 'READY',
      deletedAt: null,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (recording) {
    redirect(`/recordings/${recording.id}`);
  }

  // 没有可用录制 → 查 UPLOADING/PROCESSING
  const processing = await prisma.recording.findFirst({
    where: {
      meetingId: id,
      status: { in: ['UPLOADING', 'PROCESSING'] },
      deletedAt: null,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (processing) {
    redirect(`/recordings/${processing.id}`);
  }

  // 没有任何录制
  redirect('/');
}
