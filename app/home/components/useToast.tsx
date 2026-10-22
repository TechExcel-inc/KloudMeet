'use client';

import { useState } from 'react';
import styles from '../../../styles/Home.module.css';

/** Snackbar (bottom-left, auto-hides after 2.5s). */
export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const show = (text: string) => {
    setMsg(text);
    setTimeout(() => setMsg(null), 2500);
  };
  const el = msg ? (
    <div className={styles.toast} role="status" aria-live="polite">
      {msg}
    </div>
  ) : null;
  return { show, el };
}
