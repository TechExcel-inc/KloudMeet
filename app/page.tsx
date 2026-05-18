'use client';

import React, { Suspense } from 'react';
import styles from '../styles/Home.module.css';
import { HomeContent } from './home/HomeContent';

export default function Page() {
  return (
    <main className={styles.main}>
      <Suspense fallback="Loading">
        <HomeContent />
      </Suspense>
    </main>
  );
}
