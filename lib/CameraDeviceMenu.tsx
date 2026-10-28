'use client';

/**
 * The bar's camera menu: LiveKit's MediaDeviceMenu (same markup and classes, so the bar's
 * device-menu styles apply) with one more row under the cameras — Background.
 */

import React from 'react';
import { computeMenuPosition, wasClickOutside } from '@livekit/components-core';
import { MediaDeviceSelect } from '@livekit/components-react';
import styles from '../styles/KloudMeetToolbar.module.css';

interface CameraDeviceMenuProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  backgroundLabel: string;
  /** The current choice, shown at the row's end ("Blur", "Off"). */
  backgroundValue: string;
  onOpenBackground: () => void;
}

export function CameraDeviceMenu({
  backgroundLabel,
  backgroundValue,
  onOpenBackground,
  children,
  ...buttonProps
}: CameraDeviceMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [devices, setDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [askedPermission, setAskedPermission] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  React.useLayoutEffect(() => {
    if (open) setAskedPermission(true);
  }, [open]);

  React.useLayoutEffect(() => {
    if (!open || !buttonRef.current || !menuRef.current) return;
    return computeMenuPosition(buttonRef.current, menuRef.current, (x, y) => {
      if (menuRef.current) Object.assign(menuRef.current.style, { left: `${x}px`, top: `${y}px` });
    });
  }, [open, devices]);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current || e.target === buttonRef.current) return;
      if (buttonRef.current?.contains(e.target as Node)) return;
      if (wasClickOutside(menuRef.current, e)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        {...buttonProps}
        ref={buttonRef}
        aria-pressed={open}
        onClick={() => setOpen((v) => !v)}
      >
        {children}
      </button>
      {!buttonProps.disabled && (
        <div ref={menuRef} className="lk-device-menu" style={{ visibility: open ? 'visible' : 'hidden' }}>
          <MediaDeviceSelect
            kind="videoinput"
            requestPermissions={askedPermission}
            onDeviceListChange={setDevices}
            onActiveDeviceChange={() => setOpen(false)}
          />
          <div className={styles.deviceMenuDivider} role="separator" />
          <button
            type="button"
            className={styles.deviceMenuRow}
            onClick={() => {
              setOpen(false);
              onOpenBackground();
            }}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="3" />
              <circle cx="12" cy="10.5" r="2.6" />
              <path d="M7.5 20c.6-2.6 2.3-4.1 4.5-4.1s3.9 1.5 4.5 4.1" />
            </svg>
            <span className={styles.deviceMenuRowLabel}>{backgroundLabel}</span>
            <span className={styles.deviceMenuRowValue}>{backgroundValue}</span>
          </button>
        </div>
      )}
    </>
  );
}
