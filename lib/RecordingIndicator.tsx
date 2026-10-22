import { useIsRecording } from '@livekit/components-react';
import * as React from 'react';
import toast from 'react-hot-toast';

export function RecordingIndicator() {
  const isRecording = useIsRecording();
  const [wasRecording, setWasRecording] = React.useState(false);

  React.useEffect(() => {
    if (isRecording !== wasRecording) {
      setWasRecording(isRecording);
      if (isRecording) {
        toast('This meeting is being recorded', {
          duration: 3000,
          icon: '🎥',
          position: 'top-center',
          className: 'lk-button',
          style: {
            backgroundColor: 'var(--km-snackbar, #323232)',
            color: '#fff',
            fontFamily: 'var(--km-font, inherit)',
          },
        });
      }
    }
  }, [isRecording, wasRecording]);

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
