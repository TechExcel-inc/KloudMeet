'use client';

import React from 'react';
import styles from '../../../styles/Home.module.css';

export function KloudLogo({ size = 'sm', appendNode }: { size?: 'sm' | 'lg', appendNode?: React.ReactNode }) {
  // 尺寸调整：在上一次基础上减小约 20%
  const imgHeight = size === 'lg' ? 61 : 47;
  return (
    <div className={styles.logoRow}>
      <img 
        src="/images/kloud-header-logo.svg" 
        alt="Kloud Meet" 
        height={imgHeight} 
        style={{ display: 'block', transform: 'translateY(16px)' }} 
      />
      {appendNode}
    </div>
  );
}
