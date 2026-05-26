import * as React from 'react';
import { Suspense } from 'react';
import { PageClientImpl } from './PageClientImpl';
import { RoomEntryLoading } from '@/lib/RoomEntryLoading';
import { isVideoCodec } from '@/lib/types';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ roomName: string }>;
  searchParams: Promise<{
    region?: string;
    hq?: string;
    codec?: string;
  }>;
}) {
  const _params = await params;
  const _searchParams = await searchParams;
  const codec =
    typeof _searchParams.codec === 'string' && isVideoCodec(_searchParams.codec)
      ? _searchParams.codec
      : 'vp9';
  const hq = _searchParams.hq === 'true' ? true : false;

  return (
    <Suspense fallback={<RoomEntryLoading />}>
      <PageClientImpl
        roomName={_params.roomName}
        region={_searchParams.region}
        hq={hq}
        codec={codec}
      />
    </Suspense>
  );
}
