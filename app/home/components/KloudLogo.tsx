'use client';

import React from 'react';
import styles from '../../../styles/Home.module.css';

function useKloudTheme() {
  const [isDark, setIsDark] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const readTheme = () => {
      const attrTheme = document.documentElement.getAttribute('data-theme');
      if (attrTheme === 'dark') {
        setIsDark(true);
        return;
      }
      if (attrTheme === 'light') {
        setIsDark(false);
        return;
      }
      setIsDark(window.localStorage.getItem('kloud-theme') !== 'light');
    };

    readTheme();
    const observer = new MutationObserver(readTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  return isDark;
}

export function KloudLogo({
  size = 'sm',
  variant = 'default',
  appendNode,
}: {
  size?: 'sm' | 'lg';
  variant?: 'default' | 'nav';
  appendNode?: React.ReactNode;
}) {
  const isDark = useKloudTheme();
  const imgHeight = size === 'lg' ? 52 : 36;
  const rowClass = variant === 'nav'
    ? `${styles.logoNav} ${size === 'lg' ? styles.logoNavLg : ''}`
    : styles.logoRow;

  return (
    <div className={rowClass}>
      <img
        src={isDark ? '/images/kloud-header-logo-white.svg' : '/images/kloud-header-logo.svg'}
        alt="Kloud Meet"
        height={imgHeight}
      />
      {appendNode}
    </div>
  );
}
