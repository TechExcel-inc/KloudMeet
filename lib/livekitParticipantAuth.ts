import type { NextRequest } from 'next/server';
import { TokenVerifier } from 'livekit-server-sdk';

export interface RoomParticipant {
  identity: string;
  room: string;
}

export interface VerifyParticipantOptions {
  /** 要求 token 带发布权限（开麦转写需要，听字幕翻译不需要） */
  publish?: boolean;
}

/**
 * verifyParticipant — 校验请求头 `Authorization: Bearer <LiveKit 参会 token>`
 *
 * 登录用户与匿名访客都由 /api/connection-details 签发同一种 token，
 * 因此本函数只区分"是否正在参会"，不区分是否登录。
 *
 * @param req  请求
 * @param opts publish=true 时要求 canPublish
 * @returns 校验通过返回参会者身份与房间，否则 null
 */
export async function verifyParticipant(
  req: NextRequest,
  opts: VerifyParticipantOptions = {},
): Promise<RoomParticipant | null> {
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!key || !secret || !token) return null;

  try {
    const claims = await new TokenVerifier(key, secret).verify(token);
    const room = claims.video?.room;
    if (
      typeof claims.sub !== 'string' ||
      !claims.sub ||
      !room ||
      claims.video?.roomJoin !== true ||
      (opts.publish === true && claims.video?.canPublish !== true)
    ) {
      return null;
    }
    return { identity: claims.sub, room };
  } catch (err) {
    console.error('[verifyParticipant]', err);
    return null;
  }
}
