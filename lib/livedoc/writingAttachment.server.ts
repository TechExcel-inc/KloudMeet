import { createHash, createHmac, randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { buildPeerTimeUrl, ensureHostBypassesProxy } from '@/lib/peertimeUpstream';

export type LiveDocWritingPdf = {
  name: string;
  attachmentId: number;
  userId: string;
  key: string;
  bucket: string;
  region: string;
};

const contentType = 'application/pdf';

async function documentService<T>(path: string, userId: string, body?: object): Promise<T> {
  const token = process.env.LIVEDOC_DOCUMENT_SERVICE_TOKEN;
  if (!token) throw new Error('LiveDoc document service is not configured');
  const base = process.env.LIVEDOC_DOCUMENT_API_URL ?? 'https://livedoc.peertime.cn/TxLiveDocumentApi/api/';
  const response = await fetch(new URL(path, base.replace(/\/?$/, '/')), {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'peertime-user': userId, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json() as { Success?: boolean; Data?: T };
  if (!response.ok || result.Success !== true || !result.Data) throw new Error('LiveDoc document service failed');
  return result.Data;
}

async function kloud<T>(path: string, token: string, body?: object): Promise<T> {
  const { url, headers } = buildPeerTimeUrl(`/peertime/V1/P1Integration/${path}`);
  ensureHostBypassesProxy(url);
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { ...headers, UserToken: token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json() as { RetCode?: number; RetData?: T };
  if (!response.ok || result.RetCode !== 0 || result.RetData == null) throw new Error('Kloud attachment service failed');
  return result.RetData;
}

type Bucket = {
  ServiceProviderId: number;
  RegionName: string;
  BucketName: string;
  AccessKeyId: string;
  AccessKeySecret: string;
  SecurityToken: string;
};

async function bucketRequest(bucket: Bucket, key: string, data?: Buffer) {
  const provider = Number(bucket.ServiceProviderId);
  const credentials = {
    accessKeyId: bucket.AccessKeyId, secretAccessKey: bucket.AccessKeySecret, sessionToken: bucket.SecurityToken,
  };
  if (provider === 1 || provider === 3) {
    const [endpoint, region] = bucket.RegionName.split('#');
    const client = new S3Client({
      credentials,
      region: provider === 1 ? bucket.RegionName : region || 'us-east-1',
      ...(provider === 3 ? { endpoint: endpoint.startsWith('http') ? endpoint : `https://${endpoint}`, forcePathStyle: true } : {}),
    });
    try {
      if (data) {
        await client.send(new PutObjectCommand({ Bucket: bucket.BucketName, Key: key, Body: data, ContentType: contentType }));
        return null;
      }
      const result = await client.send(new GetObjectCommand({ Bucket: bucket.BucketName, Key: key }));
      return result.Body ? await result.Body.transformToByteArray() : null;
    } finally {
      client.destroy();
    }
  }
  if (!/^oss-[a-z0-9-]+$/.test(bucket.RegionName) || !/^[a-z0-9-]+$/.test(bucket.BucketName)) {
    throw new Error('Invalid LiveDoc bucket');
  }
  const date = new Date().toUTCString();
  const method = data ? 'PUT' : 'GET';
  const type = data ? contentType : '';
  const canonical = `${method}\n\n${type}\n${date}\nx-oss-security-token:${credentials.sessionToken}\n/${bucket.BucketName}/${key}`;
  const sig = createHmac('sha1', credentials.secretAccessKey).update(canonical).digest('base64');
  const url = `https://${bucket.BucketName}.${bucket.RegionName}.aliyuncs.com/${key.split('/').map(encodeURIComponent).join('/')}`;
  const response = await fetch(url, {
    method,
    headers: { Date: date, Authorization: `OSS ${credentials.accessKeyId}:${sig}`,
      'x-oss-security-token': credentials.sessionToken, ...(data ? { 'Content-Type': type } : {}) },
    body: data ? new Uint8Array(data) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('LiveDoc storage request failed');
  return data ? null : new Uint8Array(await response.arrayBuffer());
}

/** Register a standalone document, using the same LiveDoc upload and conversion as the meeting stage. */
export async function saveLiveDocWritingPdf(
  identity: { token: string; userId: string }, name: string, bytes: Buffer,
): Promise<LiveDocWritingPdf> {
  const { token, userId } = identity;
  const slot = await kloud<{ FileID: number; Path: string }>('UploadFilePath', token);
  if (!slot.FileID || !slot.Path) throw new Error('LiveDoc did not allocate a file');
  const bucket = await documentService<Bucket>('prepareUploading?clientIp=', userId);
  const folder = slot.Path.replace(/^\/+|\/+$/g, '');
  const key = `tempupload/${randomUUID().replace(/-/g, '')}`;
  await bucketRequest(bucket, key, bytes);

  const job = { Key: key, Bucket: {
    ServiceProviderId: bucket.ServiceProviderId, RegionName: bucket.RegionName, BucketName: bucket.BucketName,
  } };
  await documentService('startConverting', userId, { ...job, DocumentType: 'pdf', TargetFolderKey: folder });
  for (let attempt = 0; attempt < 25; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const result = await documentService<{ CurrentStatus: number; Result?: { FileName: string; Count: number } }>('queryConverting', userId, job);
    if (result.CurrentStatus === 3) throw new Error('LiveDoc conversion failed');
    if (result.CurrentStatus !== 5 || !result.Result?.FileName) continue;

    // Conversion can remove the temporary upload, so keep the downloadable original in LiveDoc storage.
    const originalKey = `${folder}/ai-write-${randomUUID()}.pdf`;
    await bucketRequest(bucket, originalKey, bytes);
    const attachmentId = Number(await kloud('UploadStandAloneFile', token, {
      FileID: slot.FileID, Title: name, FileName: result.Result.FileName,
      FileSize: bytes.length, PageCount: result.Result.Count,
      Hash: createHash('md5').update(bytes).digest('hex'), ServiceProviderID: bucket.ServiceProviderId,
    }));
    if (!Number.isSafeInteger(attachmentId) || attachmentId < 1) throw new Error('LiveDoc did not register the attachment');
    return { name, attachmentId, userId, key: originalKey, bucket: bucket.BucketName, region: bucket.RegionName };
  }
  throw new Error('LiveDoc conversion took too long');
}

export async function loadLiveDocWritingPdf(pdf: LiveDocWritingPdf) {
  const bucket = await documentService<Bucket>('prepareUploading?clientIp=', pdf.userId);
  if (bucket.BucketName !== pdf.bucket || bucket.RegionName !== pdf.region) throw new Error('LiveDoc storage location changed');
  return bucketRequest(bucket, pdf.key);
}
