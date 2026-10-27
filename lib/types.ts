import type { StoredDesignLink } from '@/lib/designLink';
import type { MeetingAccessLevel } from '@/lib/meetingAccess';
import { LocalAudioTrack, LocalVideoTrack, videoCodecs } from 'livekit-client';
import { VideoCodec } from 'livekit-client';

export interface SessionProps {
  roomName: string;
  identity: string;
  audioTrack?: LocalAudioTrack;
  videoTrack?: LocalVideoTrack;
  region?: string;
  turnServer?: RTCIceServer;
  forceRelay?: boolean;
}

export interface TokenResult {
  identity: string;
  accessToken: string;
}

export function isVideoCodec(codec: string): codec is VideoCodec {
  return videoCodecs.includes(codec as VideoCodec);
}

export type ConnectionDetails = {
  serverUrl: string;
  roomName: string;
  participantName: string;
  participantToken: string;
  /** SkyMeet meeting.id for this session; used to scope LiveDoc per personal-room session */
  meetingId: number;
  isPersonalRoom: boolean;
  /**
   * Authoritative in-meeting stage view from LiveKit room metadata.
   * Absent / undefined for first host open → client defaults to webcam.
   */
  currentView?: 'liveDoc' | 'webcam' | 'shareScreen' | 'design';
  /** Design mode: the link everyone views (from room metadata), for late joiners. */
  designLink?: StoredDesignLink | null;
  /**
   * 普通参会者是否显示文档 AI。缺省或 true 为显示；false 时普通参会者入会不显示。
   * 主持人、联席主持人和演示者不受影响。
   */
  participantLiveDocAi?: boolean;
  /** PeerTime lesson id already bound to this meeting (if any). */
  livedocInstanceId?: string | null;
  /** Who may join. Null = a meeting from before access levels (same as Public). */
  accessLevel?: MeetingAccessLevel | null;
  /**
   * Billing: ISO time the host's plan ends this meeting (Free = 40 min).
   * Absent when billing is off or the plan has no length limit.
   */
  meetingEndsAt?: string;
};
