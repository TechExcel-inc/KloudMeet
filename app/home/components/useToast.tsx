'use client';

import { useState } from 'react';
import styles from '../../../styles/Home.module.css';

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const show = (text: string) => {
    setMsg(text);
    setTimeout(() => setMsg(null), 2500);
  };
  const el = msg ? <div className={styles.toast}>{msg}</div> : null;
  return { show, el };
}
