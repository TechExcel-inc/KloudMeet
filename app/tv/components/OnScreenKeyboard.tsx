'use client';

import React from 'react';
import { Delete } from 'lucide-react';
import styles from '@/styles/Tv.module.css';

/**
 * D-pad keyboard for meeting codes: digits, a–z and the dash, ten keys a row so a column
 * jump is one press. Personal IDs (m5888) and generated codes (abc-defg-hij) both fit.
 */
const ROWS = ['1234567890', 'abcdefghij', 'klmnopqrst', 'uvwxyz-'];

export function OnScreenKeyboard({
  onKey,
  onDelete,
  onClear,
  onSubmit,
  submitLabel,
  clearLabel,
  deleteLabel,
  canSubmit,
}: {
  onKey: (ch: string) => void;
  onDelete: () => void;
  onClear: () => void;
  onSubmit: () => void;
  submitLabel: string;
  clearLabel: string;
  deleteLabel: string;
  canSubmit: boolean;
}) {
  return (
    <div className={styles.keyboard} role="group" aria-label="Keyboard">
      {ROWS.map((row, r) => (
        <div key={row} className={styles.kbRow}>
          {row.split('').map((ch, i) => (
            <button
              key={ch}
              type="button"
              className={styles.kbKey}
              onClick={() => onKey(ch)}
              {...(r === 1 && i === 0 ? { 'data-tv-autofocus': true } : {})}
            >
              {ch}
            </button>
          ))}
          {r === 3 && (
            <button type="button" className={`${styles.kbKey} ${styles.kbWide3}`} onClick={onDelete} aria-label={deleteLabel}>
              <Delete size={38} />
            </button>
          )}
        </div>
      ))}
      <div className={styles.kbRow}>
        <button type="button" className={`${styles.kbKey} ${styles.kbWide3} ${styles.kbText}`} onClick={onClear}>
          {clearLabel}
        </button>
        <button
          type="button"
          className={`${styles.kbKey} ${styles.kbWide7} ${styles.kbSubmit}`}
          onClick={onSubmit}
          aria-disabled={!canSubmit}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
