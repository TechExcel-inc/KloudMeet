import { useIsRecording } from '@livekit/components-react';
import * as React from 'react';
import toast from 'react-hot-toast';
import { useI18n } from '@/lib/i18n';

/**
 * Tells everyone in the meeting when recording starts, and frames the meeting while it runs.
 *
 * @param notes  AI Taking Notes: speech becomes text and no audio or video is kept, so the
 *               notice says that instead of "recorded"
 */
export function RecordingIndicator({ notes = false }: { notes?: boolean }) {
  const { t } = useI18n();
  const isRecording = useIsRecording();
  // The room reports "recording" a moment before the meeting's recording state arrives; read the
  // mode when the notice is shown, not when recording was first seen.
  const notesRef = React.useRef(notes);
  notesRef.current = notes;

  React.useEffect(() => {
    if (!isRecording) return;
    const timer = setTimeout(() => {
      toast(notesRef.current ? t('toolbar.notesStarted') : t('toolbar.recordingStarted'), {
        duration: notesRef.current ? 5000 : 3000,
        icon: notesRef.current ? '📝' : '🎥',
        position: 'top-center',
        className: 'lk-button',
        style: {
          backgroundColor: 'var(--km-snackbar, #323232)',
          color: '#fff',
          fontFamily: 'var(--km-font, inherit)',
        },
      });
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  return (
    <div
      style={{
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        boxShadow: isRecording ? 'var(--km-danger, #dc362e) 0px 0px 0px 3px inset' : 'none',
        pointerEvents: 'none',
      }}
    ></div>
  );
}
