import React from 'react';
import styles from '../styles/LiveDocView.module.css';

interface LiveDocViewProps {
  roomName: string;
  participantName?: string;
}

export function LiveDocView({ roomName, participantName }: LiveDocViewProps) {
  const initials = participantName
    ? participantName.slice(0, 2).toUpperCase()
    : '??';

  return (
    <div className={styles.container}>
      <div className={styles.roomInfo}>
        <h2 className={styles.roomTitle}>Meetings room ID: {roomName}</h2>
        <p className={styles.roomSubtitle}>SkyMeet</p>
      </div>

      <div className={styles.participant}>
        <div className={styles.avatar}>{initials}</div>
        <span className={styles.avatarName}>{participantName || 'You'}</span>
      </div>

      <div className={styles.cardGrid}>
        <div className={styles.card}>
          <svg className={styles.cardIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className={styles.cardLabel}>Upload Document</span>
        </div>

        <div className={styles.card}>
          <svg className={styles.cardIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <span className={styles.cardLabel}>Share Screen</span>
        </div>

        <div className={styles.card}>
          <svg className={styles.cardIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className={styles.cardLabel}>Invite</span>
        </div>

        <div className={styles.card}>
          <svg className={styles.cardIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className={styles.cardLabel}>Create Blank Page</span>
        </div>
      </div>
    </div>
  );
}
