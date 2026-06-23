'use client';

import React from 'react';
import styles from '../../../styles/Home.module.css';

export function KloudLogo({ size = 'sm', appendNode }: { size?: 'sm' | 'lg', appendNode?: React.ReactNode }) {
  // Match the pre-join toolbar treatment so the logo reads cleanly in dark mode.
  const imgHeight = size === 'lg' ? 52 : 36;
  return (
    <div className={styles.logoRow}>
      <img 
        src="/images/kloud-header-logo.svg" 
        alt="Kloud Meet" 
        height={imgHeight} 
        style={{ display: 'block', transform: 'translateY(4px)' }} 
      />
      {appendNode}
    </div>
  );
}
