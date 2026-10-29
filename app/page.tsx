'use client';

import React, { Suspense } from 'react';
import styles from '../styles/Home.module.css';
import { HomeContent } from './home/HomeContent';
import { SlowLoadHint } from '@/lib/SlowLoadHint';

export default function Page() {
  return (
    <main className={styles.main}>
      <Suspense
        fallback={
          <div className={styles.authInitializing} aria-label="Loading">
            <div className={styles.meetingLoadingSpinner} />
            <SlowLoadHint />
          </div>
        }
      >
        <HomeContent />
      </Suspense>
    </main>
  );
}
