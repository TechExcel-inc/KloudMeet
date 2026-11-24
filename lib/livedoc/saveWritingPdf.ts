import { authFetch } from '@/lib/kloudSession';
import { buildLiveDocIframeSrc } from '@/lib/livedoc/client';
import { isLiveDocAiInboundMessage, LIVE_DOC_AI_CHANNEL, LIVE_DOC_AI_VERSION } from '@/lib/liveDocAiProtocol';

export async function saveWritingPdf(meetingId: number, fileName: string, fileBuffer: ArrayBuffer): Promise<number> {
  const identity = await authFetch('/api/livedoc/stage-identity', { method: 'POST' });
  if (!identity.ok) throw new Error('Could not open LiveDoc');
  const { token } = await identity.json();
  if (typeof token !== 'string' || !token) throw new Error('LiveDoc sign-in required');
  const frame = document.createElement('iframe');
  frame.title = 'LiveDoc attachment upload';
  frame.hidden = true;
  frame.src = buildLiveDocIframeSrc(String(meetingId), token, 1) + '&aiWriteAttachment=1';
  const origin = new URL(frame.src).origin;
  const sessionId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const envelope = { channel: LIVE_DOC_AI_CHANNEL, version: LIVE_DOC_AI_VERSION, sessionId };

  return new Promise((resolve, reject) => {
    let sent = false;
    const finish = (error?: Error, attachmentId?: number) => {
      window.removeEventListener('message', receive);
      window.clearInterval(subscribeTimer);
      window.clearTimeout(timeout);
      frame.remove();
      if (error) reject(error);
      else resolve(attachmentId!);
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== origin ||
        !isLiveDocAiInboundMessage(event.data) || event.data.sessionId !== sessionId) return;
      const message = event.data;
      if (message.type === 'Kloud-LiveDocAiSnapshot' && message.state.ready && !sent) {
        sent = true;
        frame.contentWindow?.postMessage({
          ...envelope, type: 'Kloud-LiveDocAiAction', requestId, action: 'document.saveStandalonePdf',
          payload: { uploadId: requestId, fileName, fileType: 'application/pdf', fileBuffer },
        }, origin, [fileBuffer]);
      } else if (message.type === 'Kloud-LiveDocAiActionResult' && message.requestId === requestId && !message.ok) {
        finish(new Error(message.error || 'LiveDoc upload failed'));
      } else if (message.type === 'Kloud-LiveDocAiUploadResult' && message.uploadId === requestId) {
        const id = Number(message.attachmentId);
        if (message.status !== 'added' || !Number.isSafeInteger(id) || id < 1) finish(new Error('LiveDoc did not save the document'));
        else finish(undefined, id);
      }
    };
    const subscribeTimer = window.setInterval(() => {
      if (!sent) frame.contentWindow?.postMessage({ ...envelope, type: 'Kloud-LiveDocAiSubscribe' }, origin);
    }, 500);
    const timeout = window.setTimeout(() => finish(new Error('LiveDoc upload timed out')), 180000);
    window.addEventListener('message', receive);
    document.body.append(frame);
  });
}
