'use client';

import { useRef, useState } from 'react';
import styles from '../../../styles/Home.module.css';

export type ToastAction = { label: string; onClick: () => void };

/** Snackbar (bottom-left). Hides after 2.5s, or 6s when it carries an action. */
export function useToast() {
  const [toast, setToast] = useState<{ text: string; action?: ToastAction } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = (text: string, action?: ToastAction) => {
    setToast({ text, action });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), action ? 6000 : 2500);
  };
  const el = toast ? (
    <div className={styles.toast} role="status" aria-live="polite">
      {toast.text}
      {toast.action && (
        <button
          type="button"
          className={styles.toastAction}
          onClick={() => {
            toast.action?.onClick();
            setToast(null);
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  ) : null;
  return { show, el };
}
