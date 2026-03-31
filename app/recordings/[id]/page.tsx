'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface RecordingInfo {
  id: number;
  fileName: string;
  status: string;
  durationSeconds: number | null;
  fileSizeBytes: number | null;
  createdAt: string;
  meeting?: { roomName: string };
  teamMember?: { fullName: string; username: string };
}

export default function PlaybackPage() {
  const params = useParams();
  const id = params?.id as string;

  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState<RecordingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    async function loadRecording() {
      try {
        // Fetch presigned stream URL
        const res = await fetch(`/api/recordings/${id}/stream`);
        const data = await res.json();

        if (!res.ok) {
          setError(data.error || '录制视频暂时无法访问');
          setLoading(false);
          return;
        }

        setStreamUrl(data.url);
      } catch (e: any) {
        setError(e.message || '加载失败');
      } finally {
        setLoading(false);
      }
    }

    loadRecording();
  }, [id]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ textAlign: 'center', color: '#e2e8f0' }}>
          <div style={{ width: 48, height: 48, border: '4px solid #334155', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
          <p>正在加载录制视频...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (error || !streamUrl) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ textAlign: 'center', padding: 40, background: '#1e293b', borderRadius: 16, border: '1px solid #334155', maxWidth: 400 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ color: '#f1f5f9', marginBottom: 8 }}>视频暂未就绪</h2>
          <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 24 }}>
            {error || '该录制仍在处理中，请稍后重试。'}
          </p>
          <Link href="/" style={{ background: '#3b82f6', color: '#fff', padding: '10px 24px', borderRadius: 8, textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{ background: '#1e293b', padding: '14px 24px', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20 }}>🎬</span>
          <h1 style={{ margin: 0, fontSize: 17, color: '#f1f5f9', fontWeight: 600 }}>
            会议录制回放
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <a
            href={streamUrl}
            download
            style={{ background: '#334155', color: '#e2e8f0', border: '1px solid #475569', padding: '7px 16px', borderRadius: 8, textDecoration: 'none', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            ⬇ 下载 MP4
          </a>
          <Link
            href="/"
            style={{ background: '#3b82f6', color: '#fff', padding: '7px 16px', borderRadius: 8, textDecoration: 'none', fontSize: 13, fontWeight: 500 }}
          >
            返回首页
          </Link>
        </div>
      </header>

      {/* Video Player */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px' }}>
        <div style={{ maxWidth: 1000, width: '100%', borderRadius: 16, overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', background: '#000' }}>
          <video
            src={streamUrl}
            controls
            autoPlay
            style={{ width: '100%', display: 'block', maxHeight: '75vh' }}
          >
            您的浏览器不支持视频播放。
          </video>
        </div>
        <p style={{ color: '#475569', fontSize: 12, marginTop: 16 }}>
          ⚡ 播放链接有效期 1 小时，过期后请刷新页面重新加载
        </p>
      </main>
    </div>
  );
}
