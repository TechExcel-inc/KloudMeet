'use client';

import React from 'react';
import { encodeQr, qrSvgPath } from '@/lib/tv/qrCode';

/** Dark-on-white QR code drawn as one SVG path (scales without blur). */
export function QrCode({ value, label }: { value: string; label?: string }) {
  const qr = React.useMemo(() => (value ? encodeQr(value, 'M') : null), [value]);
  if (!qr) return null;
  const n = qr.size + 8;
  return (
    <svg
      viewBox={`0 0 ${n} ${n}`}
      width="100%"
      height="100%"
      role="img"
      aria-label={label ?? 'QR code'}
      shapeRendering="crispEdges"
      data-qr-value={value}
    >
      <rect width={n} height={n} fill="#fff" />
      <path d={qrSvgPath(qr)} fill="#0b0c10" />
    </svg>
  );
}
