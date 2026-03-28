import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import Link from 'next/link';

export default async function PlaybackPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const recordingId = parseInt(resolvedParams.id, 10);
  
  if (isNaN(recordingId)) {
    return notFound();
  }

  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    include: {
      meeting: true,
      teamMember: true,
    }
  });

  if (!recording || recording.status !== 'READY' || !recording.storageUrl) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>
        <h2>Recording Not Available</h2>
        <p>This recording is still processing, failed, or has been deleted.</p>
        <Link href="/" style={{ color: '#0b57d0', textDecoration: 'none' }}>Back to Dashboard</Link>
      </div>
    );
  }

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: '#f3f4f6', 
      fontFamily: 'Inter, sans-serif',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <header style={{ 
        background: '#fff', 
        padding: '16px 24px', 
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '18px', color: '#111827' }}>
            Meeting Recording: {recording.meeting.roomName}
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#6b7280' }}>
            Recorded by {recording.teamMember.fullName || recording.teamMember.username} on {new Date(recording.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <a 
            href={recording.storageUrl} 
            download
            style={{ 
              background: '#fff', 
              color: '#374151', 
              border: '1px solid #d1d5db', 
              padding: '8px 16px', 
              borderRadius: '6px',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Download MP4
          </a>
          <Link 
            href="/"
            style={{ 
              background: '#0b57d0', 
              color: '#fff', 
              border: 'none', 
              padding: '8px 16px', 
              borderRadius: '6px',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: 500
            }}
          >
            Dashboard
          </Link>
        </div>
      </header>
      
      <main style={{ flex: 1, padding: '24px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ 
          maxWidth: '1000px', 
          width: '100%', 
          background: '#000', 
          borderRadius: '12px', 
          overflow: 'hidden',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
        }}>
          <video 
            src={recording.storageUrl} 
            controls 
            autoPlay 
            style={{ width: '100%', display: 'block' }}
          >
            Your browser does not support the video element.
          </video>
        </div>
      </main>
    </div>
  );
}
