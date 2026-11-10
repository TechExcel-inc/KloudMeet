import type { EgressInfo } from 'livekit-server-sdk';

type EgressFile = EgressInfo['fileResults'][number];

/**
 * egressOutputFile — 取出一次 egress 写好的文件
 *
 * 新结果在 fileResults。LiveKit 仍常只填废弃的 result.file，fileResults 为空。
 */
export function egressOutputFile(info: EgressInfo): EgressFile | null {
  const listed = info.fileResults?.find((file) => file.filename);
  if (listed) return listed;
  if (info.result?.case === 'file' && info.result.value.filename) return info.result.value;
  const legacy = (info as EgressInfo & { file?: EgressFile }).file;
  if (legacy?.filename) return legacy;
  return null;
}
