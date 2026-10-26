import { Track, type Room } from 'livekit-client';
import { MIC_PUBLISH_RETRY_MS } from './roomConstants';

/** 发布麦克风，失败重试一次，返回是否真的在发声，供调用方校正 UI。 */
export async function publishMic(room: Room): Promise<boolean> {
  const lp = room.localParticipant;
  try {
    await lp.setMicrophoneEnabled(true);
  } catch (err) {
    console.warn('[KloudMeet] Mic publish failed, retrying once:', err);
    await new Promise((resolve) => setTimeout(resolve, MIC_PUBLISH_RETRY_MS));
    await lp.setMicrophoneEnabled(true).catch((retryErr: Error) => {
      console.warn('[KloudMeet] Mic publish retry failed:', retryErr.message);
    });
  }
  const pub = lp.getTrackPublication(Track.Source.Microphone);
  return Boolean(pub?.track && !pub.isMuted);
}
