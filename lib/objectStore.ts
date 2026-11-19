import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';

/** 和活文档插件一致：1 是 AWS S3，2 是阿里云，3 是自建的 S3 兼容地址。 */
export type StoreProvider = 's3' | 'aliyun' | 's3compat';

const S3_PART = 5 * 1024 * 1024;
const ALIYUN_SMALL = 512 * 1024;
const ALIYUN_LARGE = 1024 * 1024;
const LARGE_FILE = 10 * 1024 * 1024;
const PART_TRIES = 5;
const RETRY_WAIT_MS = 3000;

/**
 * providerOf — 按存储地址判断往哪传
 *
 * 地址里有 aliyuncs.com 走阿里云；写了别的地址走 S3 兼容；否则走 AWS S3。
 */
export function providerOf(endpoint: string | undefined): StoreProvider {
  const value = endpoint ?? '';
  if (value.includes('aliyuncs.com')) return 'aliyun';
  if (value && !value.includes('amazonaws.com')) return 's3compat';
  return 's3';
}

/**
 * partSize — 分段大小，和插件相同
 *
 * S3 每段 5MB。阿里云大于等于 10MB 时每段 1MB，否则每段 512KB。
 */
export function partSize(provider: StoreProvider, bytes: number): number {
  if (provider !== 'aliyun') return S3_PART;
  return bytes >= LARGE_FILE ? ALIYUN_LARGE : ALIYUN_SMALL;
}

/** 共享截图单独放在这个前缀下，不和会议视频、文档附件混在一起。 */
export function screenShotKey(room: string, at: number, id: string): string {
  const safe = room.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `ScreenShot/${safe}/${at}-${id}.jpg`;
}

/** 按当前环境的桶配置建一个客户端。阿里云和自建地址会带上 endpoint。 */
export function storeClient(): S3Client {
  const endpoint = process.env.S3_ENDPOINT;
  const provider = providerOf(endpoint);
  return new S3Client({
    region: process.env.S3_REGION || 'us-west-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || '',
      secretAccessKey: process.env.S3_SECRET || '',
    },
    ...(endpoint && provider !== 's3' ? { endpoint, forcePathStyle: provider === 's3compat' } : {}),
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * putMultipart — 分段上传一个对象
 *
 * 某一段失败会隔 3 秒再试，最多 5 次。整次失败会取消这次分段，不留下半截文件。
 */
export async function putMultipart(key: string, body: Buffer, contentType: string): Promise<void> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('Storage is not configured');
  const client = storeClient();
  const size = partSize(providerOf(process.env.S3_ENDPOINT), body.length);
  const created = await client.send(
    new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
  );
  const uploadId = created.UploadId;
  if (!uploadId) throw new Error('CreateMultipartUpload failed');
  try {
    const parts: Array<{ PartNumber: number; ETag: string }> = [];
    const total = Math.max(1, Math.ceil(body.length / size));
    for (let i = 1; i <= total; i++) {
      const start = size * (i - 1);
      const end = Math.min(start + size, body.length);
      parts.push({ PartNumber: i, ETag: await uploadPart(client, bucket, key, uploadId, i, body.subarray(start, end)) });
    }
    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
  } catch (err) {
    await client
      .send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }))
      .catch((abortErr) => console.error('[objectStore] abort multipart', abortErr));
    throw err;
  }
}

async function uploadPart(
  client: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
  partNumber: number,
  body: Buffer,
): Promise<string> {
  let last: unknown;
  for (let n = 0; n < PART_TRIES; n++) {
    try {
      const sent = await client.send(
        new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber, Body: body }),
      );
      if (!sent.ETag) throw new Error('UploadPart returned no ETag');
      return sent.ETag;
    } catch (err) {
      last = err;
      if (n < PART_TRIES - 1) await wait(RETRY_WAIT_MS);
    }
  }
  throw last instanceof Error ? last : new Error('UploadPart failed');
}
