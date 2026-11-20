'use client';

import React from 'react';
import s from '@/styles/NotesReplayStage.module.css';
import { initials } from './captions';

/** Small building blocks shared by the presentation player and the caption stage. */

type IconProps = { size?: number };
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};
const box = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24' });

export const PlayIcon = ({ size = 18 }: IconProps) => (
  <svg {...box(size)} fill="currentColor" aria-hidden="true"><path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11.3-6.8a1 1 0 0 0 0-1.72L9.5 4.34A1 1 0 0 0 8 5.2z" /></svg>
);
export const PauseIcon = ({ size = 18 }: IconProps) => (
  <svg {...box(size)} fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4.2" height="15" rx="1.2" /><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2" /></svg>
);
export const PrevIcon = ({ size = 18 }: IconProps) => (
  <svg {...box(size)} fill="currentColor" aria-hidden="true"><path d="M18.5 6.3v11.4a.8.8 0 0 1-1.24.67L9 12.67a.8.8 0 0 1 0-1.34l8.26-5.7a.8.8 0 0 1 1.24.67z" /><rect x="5" y="5.5" width="2.4" height="13" rx="1.2" /></svg>
);
export const NextIcon = ({ size = 18 }: IconProps) => (
  <svg {...box(size)} fill="currentColor" aria-hidden="true"><path d="M5.5 6.3v11.4a.8.8 0 0 0 1.24.67l8.26-5.7a.8.8 0 0 0 0-1.34l-8.26-5.7a.8.8 0 0 0-1.24.67z" /><rect x="16.6" y="5.5" width="2.4" height="13" rx="1.2" /></svg>
);
export const ReplayIcon = ({ size = 18 }: IconProps) => (
  <svg {...box(size)} {...stroke}><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" /><polyline points="3.5 4 3.5 8.6 8.1 8.6" /></svg>
);
export const VoiceOnIcon = ({ size = 18 }: IconProps) => (
  <svg {...box(size)} {...stroke}><path d="M11 5.5 6.5 9H3.5v6h3l4.5 3.5z" /><path d="M15.2 9.2a4 4 0 0 1 0 5.6" /><path d="M18 6.5a8 8 0 0 1 0 11" /></svg>
);
export const VoiceOffIcon = ({ size = 18 }: IconProps) => (
  <svg {...box(size)} {...stroke}><path d="M11 5.5 6.5 9H3.5v6h3l4.5 3.5z" /><line x1="16" y1="9.5" x2="21" y2="14.5" /><line x1="21" y1="9.5" x2="16" y2="14.5" /></svg>
);
export const MoreIcon = ({ size = 18 }: IconProps) => (
  <svg {...box(size)} fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="18.5" cy="12" r="1.7" /></svg>
);
export const SparkIcon = ({ size = 14 }: IconProps) => (
  <svg {...box(size)} fill="currentColor" aria-hidden="true"><path d="M11 2.5c.5 4.6 2.4 6.5 7 7-4.6.5-6.500 2.400-7 7-.5-4.600-2.400-6.500-7-7 4.600-.500 6.500-2.400 7-7z" /><path d="M18.500 14.500c.250 2.300 1.200 3.250 3.500 3.500-2.300.250-3.250 1.200-3.500 3.500-.250-2.300-1.200-3.250-3.500-3.500 2.300-.250 3.250-1.200 3.500-3.500z" /></svg>
);
export const TimelineIcon = ({ size = 14 }: IconProps) => (
  <svg {...box(size)} {...stroke}><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="14" y2="12" /><line x1="4" y1="17" x2="17" y2="17" /></svg>
);
export const CheckIcon = ({ size = 16 }: IconProps) => (
  <svg {...box(size)} {...stroke} strokeWidth={2.6}><polyline points="5 12.5 10 17.5 19 7.5" /></svg>
);
export const JumpIcon = ({ size = 12 }: IconProps) => (
  <svg {...box(size)} {...stroke} strokeWidth={2.4}><line x1="7" y1="17" x2="17" y2="7" /><polyline points="9 7 17 7 17 15" /></svg>
);
export const ClockIcon = ({ size = 12 }: IconProps) => (
  <svg {...box(size)} {...stroke}><circle cx="12" cy="12" r="8.5" /><polyline points="12 7.5 12 12 15 14" /></svg>
);
export const CalendarIcon = ({ size = 12 }: IconProps) => (
  <svg {...box(size)} {...stroke}><rect x="3.500" y="5" width="17" height="15.500" rx="2.500" /><line x1="3.500" y1="10" x2="20.500" y2="10" /><line x1="8" y1="3" x2="8" y2="6.500" /><line x1="16" y1="3" x2="16" y2="6.500" /></svg>
);
export const KeyIcon = ({ size = 11 }: IconProps) => (
  <svg {...box(size)} fill="currentColor" aria-hidden="true"><path d="M12 2.500 21.500 12 12 21.500 2.500 12z" /></svg>
);
export const QuoteIcon = ({ size = 22 }: IconProps) => (
  <svg {...box(size)} fill="currentColor" aria-hidden="true"><path d="M4 17.500v-4.300C4 9.300 5.900 6.700 9.600 5.500l.9 1.900C8.600 8.200 7.700 9.500 7.600 11H10.500v6.500zm9.500 0v-4.300c0-3.900 1.900-6.500 5.600-7.700l.9 1.900c-1.900.800-2.800 2.100-2.900 3.600H20v6.500z" /></svg>
);
export const AlertIcon = ({ size = 22 }: IconProps) => (
  <svg {...box(size)} {...stroke}><circle cx="12" cy="12" r="9" /><line x1="12" y1="7.500" x2="12" y2="13" /><circle cx="12" cy="16.400" r="0.600" fill="currentColor" /></svg>
);

export const Spinner = () => <span className={s.spinner} aria-hidden="true" />;

export function Avatar({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span className={className ? `${s.avatar} ${className}` : s.avatar} style={{ background: color }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Shown after the label when there is room */
  detail?: string;
  icon?: React.ReactNode;
}

/** Two or three choices in one pill; the chosen one is pressed. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={className ? `${s.segmented} ${className}` : s.segmented} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? `${s.segment} ${s.segmentOn}` : s.segment}
          aria-pressed={option.value === value}
          onClick={() => {
            if (option.value !== value) onChange(option.value);
          }}
        >
          {option.icon}
          <span className={s.segmentLabel}>{option.label}</span>
          {option.detail && <span className={s.segmentDetail}>{option.detail}</span>}
        </button>
      ))}
    </div>
  );
}
