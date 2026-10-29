'use client';

/**
 * The root layout itself failed (no providers or styles from it), so this page carries its own
 * styles and says it in English and Chinese.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: '24px 16px',
          boxSizing: 'border-box',
          textAlign: 'center',
          background: '#f5f6f8',
          color: '#1f2329',
          fontFamily: 'system-ui, -apple-system, "PingFang SC", sans-serif',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>This page couldn’t load · 页面没能加载出来</h1>
        <p style={{ margin: 0, maxWidth: 360, fontSize: 14, lineHeight: 1.5, color: '#6b7280' }}>
          Reload to try again. In WeChat, tap ··· at the top right and choose Open in Browser.
          <br />
          请重新加载。在微信里，可以点右上角 ··· 选择“在浏览器打开”。
        </p>
        <p style={{ margin: 0, maxWidth: 360, fontSize: 12, color: '#6b7280', fontFamily: 'ui-monospace, Menlo, monospace', wordBreak: 'break-word' }}>
          {error.message || error.digest || error.name}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            minHeight: 40,
            padding: '0 20px',
            border: 0,
            borderRadius: 999,
            background: '#5552d9',
            color: '#fff',
            font: 'inherit',
            fontWeight: 600,
          }}
        >
          Reload · 重新加载
        </button>
      </body>
    </html>
  );
}
