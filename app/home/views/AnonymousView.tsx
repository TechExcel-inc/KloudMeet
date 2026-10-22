'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import styles from '../../../styles/Home.module.css';
import { TopToolbar } from '../components/TopToolbar';
import { useTx } from '../components/ui';
import { roomPath } from '@/lib/roomUrl';
import { MAC_APP_AVAILABLE } from '@/lib/desktopRelease';

const SLIDE_COUNT = 3;
const SLIDE_INTERVAL_MS = 5000;

/* Decorative, text-free illustrations for the carousel (work in every locale). */
function SlideArt({ index }: { index: number }) {
  if (index === 0) {
    return (
      <div className={styles.illDoc}>
        <div className={styles.illAvatars}>
          <span className={styles.illAvatar} style={{ background: '#8B87FF' }} />
          <span className={styles.illAvatar} style={{ background: '#FFB877' }} />
          <span className={styles.illAvatar} style={{ background: '#5FD3A6' }} />
        </div>
        <div className={styles.illEyebrow} />
        <div className={styles.illHeading} />
        <div className={styles.illLine} style={{ width: '90%', marginTop: 12 }} />
        <div className={styles.illLine} style={{ width: '70%' }} />
        <div className={`${styles.illLine} ${styles.illLineAccent}`} style={{ width: '80%' }} />
        <svg className={styles.illCursor} width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 3l14 7-6 2-2 6z" fill="#5E5CE6" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  if (index === 1) {
    return (
      <div className={styles.illPlayer}>
        <div className={styles.illPlayerVideo}>
          <span className={styles.illPlayBtn}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#1F1F1F" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </div>
        <div className={styles.illPlayerBody}>
          <div className={styles.illTrack}>
            <span className={styles.illSeg} style={{ left: '4%', width: '30%', background: '#8B87FF' }} />
            <span className={styles.illSeg} style={{ left: '38%', width: '18%', background: '#FFB877' }} />
            <span className={styles.illSeg} style={{ left: '60%', width: '32%', background: '#8B87FF' }} />
            <span className={styles.illPlayhead} />
          </div>
          <div className={styles.illPills}>
            <span className={`${styles.illPill} ${styles.illPillOn}`} />
            <span className={styles.illPill} />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.illTile}>
      <span className={styles.illFace}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
        </svg>
      </span>
      <div className={styles.illCaption}>
        <div className={styles.illCaptionLine} />
        <div className={styles.illCaptionLine} />
      </div>
    </div>
  );
}

export function AnonymousView({
  onSignIn,
  onSignUp,
  onOpenHelp,
  toast,
}: {
  onSignIn: () => void;
  onSignUp: () => void;
  onOpenHelp: () => void;
  toast: { show: (t: string) => void };
}) {
  const { t } = useI18n();
  const tx = useTx();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [scheduledModalData, setScheduledModalData] = useState<any>(null);
  const [countdown, setCountdown] = useState<string>('');
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  /* ── Carousel ── */
  const [slide, setSlide] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);

  useEffect(() => {
    if (!autoPlay) return;
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const id = setInterval(() => setSlide((s) => (s + 1) % SLIDE_COUNT), SLIDE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoPlay]);

  const goToSlide = (i: number) => {
    setAutoPlay(false);
    setSlide(((i % SLIDE_COUNT) + SLIDE_COUNT) % SLIDE_COUNT);
  };

  const slides = [
    {
      title: tx('anon.carousel.docTitle', 'Meet on the document'),
      desc: tx(
        'anon.carousel.docDesc',
        'Everyone follows the same LiveDoc page — sharper than a screen share, and annotations stay with the file.',
      ),
    },
    {
      title: tx('anon.carousel.replayTitle', 'Replays with a timeline'),
      desc: tx('anon.carousel.replayDesc', 'Recordings come back with a speaker timeline, transcript and AI summary.'),
    },
    {
      title: tx('anon.carousel.captionsTitle', 'Captions that translate'),
      desc: tx('anon.carousel.captionsDesc', 'Turn on Speech to Text and read along in your own language.'),
    },
  ];

  useEffect(() => {
    if (!scheduledModalData?.scheduledFor) return;
    const tick = () => {
      const target = new Date(scheduledModalData.scheduledFor).getTime();
      const diffMs = target - Date.now();
      if (diffMs <= 0) {
        setCountdown("00:00");
        return;
      }
      const totalSec = Math.floor(diffMs / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      setCountdown(`${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
    };
    tick();
    const intv = setInterval(tick, 1000);
    return () => clearInterval(intv);
  }, [scheduledModalData]);

  const handleJoin = async () => {
    const raw = code.trim();
    if (!raw) {
      setWarningMessage(t('anon.meetingCodeEmpty'));
      return;
    }
    if (isJoining) return;

    let roomId = raw;
    if (raw.includes('/rooms/')) {
      roomId = raw.split('/rooms/')[1].split('?')[0].split('#')[0];
    } else {
      roomId = raw.replace(/\s/g, '');
    }

    if (!roomId) {
      toast.show(t('anon.enterValidCode'));
      return;
    }

    const roomPathTarget = roomPath(roomId);

    setIsJoining(true);

    try {
      const res = await fetch(`/api/meetings/${encodeURIComponent(roomId)}`);

      // 1. Non-Existing
      if (!res.ok) {
        setWarningMessage(t('anon.meetingNotFound'));
        setIsJoining(false);
        return;
      }

      const data = await res.json();

      // 2. Already Finished
      if (data.status === 'ENDED' && !data.isPersonalRoom) {
        setWarningMessage(t('anon.meetingEnded'));
        setIsJoining(false);
        return;
      }

      // 6. Already In Progress
      if (data.isActive) {
        router.push(roomPathTarget);
        return;
      }

      // Check Scheduling
      if (data.scheduledFor) {
        const diffMs = new Date(data.scheduledFor).getTime() - Date.now();

        if (diffMs > 0) {
          // 4 & 5. Scheduled for Future (> 1Hr & < 1Hr) handled by the inline card
          setScheduledModalData(data);
          setIsJoining(false);
          return;
        } else {
          // 3. Past Start Date (But Not Started)
          toast.show(t('anon.pastStartTime'));
          router.push(roomPathTarget);
          return;
        }
      }

      // Valid Path (3, 4, 5, 6)
      router.push(roomPathTarget);
    } catch(e) {
      console.error(e);
      setWarningMessage(t('anon.apiError'));
      setIsJoining(false);
    }
  };

  const hasCode = code.trim().length > 0;
  const scheduledDiffMs = scheduledModalData
    ? new Date(scheduledModalData.scheduledFor).getTime() - Date.now()
    : 0;

  return (
    <div className={styles.anonWrapper}>
      <TopToolbar onSignIn={onSignIn} onSignUp={onSignUp} onOpenHelp={onOpenHelp} hideAvatar={true} showClock />

      <div className={styles.anonContainer}>
        {/* ── Left: headline + join ── */}
        <section className={styles.anonHero}>
          <h1 className={styles.anonTitle}>
            {tx('anon.heroTitle', 'Meet on the document.')}
            <br />
            <span className={styles.anonTitleAccent}>{tx('anon.heroAccent', 'Replay it anytime.')}</span>
          </h1>
          <p className={styles.anonSubtitle}>
            {tx(
              'anon.heroSubtitle',
              'Where AI agents learn from and work with your teams and customers. Join from your browser — no account needed.',
            )}
          </p>

          <div className={styles.anonJoinGroup}>
            <label className={`${styles.codeField}${warningMessage ? ` ${styles.codeFieldError}` : ''}`}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="6" width="20" height="12" rx="2.5"></rect>
                <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"></path>
              </svg>
              <span className={styles.srOnly}>{t('anon.enterMeetingCode')}</span>
              <input
                placeholder={t('anon.enterMeetingCode')}
                value={code}
                autoComplete="off"
                aria-invalid={!!warningMessage}
                aria-describedby={warningMessage ? 'anon-join-error' : undefined}
                onChange={(e) => {
                  setCode(e.target.value);
                  if (warningMessage) setWarningMessage(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              />
            </label>
            <button
              type="button"
              className={`${styles.btn} ${hasCode ? styles.btnFill : styles.btnTonal} ${styles.anonJoinBtn}`}
              onClick={handleJoin}
              disabled={isJoining}
              aria-busy={isJoining}
            >
              {isJoining && (
                <svg className={styles.spinner} viewBox="0 0 24 24" fill="none" width="18" height="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M21 12a9 9 0 11-6.219-8.56"></path>
                </svg>
              )}
              {isJoining ? t('common.joining') : t('anon.joinMeeting')}
            </button>
          </div>

          {/* Join errors — inline instead of a blocking dialog */}
          {warningMessage && (
            <div className={styles.anonAlert} role="alert" id="anon-join-error">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9"></circle>
                <path d="M12 8v5M12 16h.01"></path>
              </svg>
              <span className={styles.anonAlertText}>{warningMessage}</span>
              <button
                type="button"
                className={`${styles.iconBtn} ${styles.anonAlertClose}`}
                onClick={() => setWarningMessage(null)}
                aria-label={t('common.close')}
                title={t('common.close')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          )}

          {/* Scheduled meeting — inline card */}
          {scheduledModalData && (
            <div className={styles.scheduledCard} role="status">
              <div className={styles.scheduledEyebrow}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="16" rx="3"></rect>
                  <path d="M3 10h18M8 3v4M16 3v4"></path>
                </svg>
                {t('anon.scheduledMeeting')}
              </div>
              <button
                type="button"
                className={`${styles.iconBtn} ${styles.scheduledClose}`}
                onClick={() => setScheduledModalData(null)}
                aria-label={t('common.close')}
                title={t('common.close')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
              <p className={styles.scheduledTitle}>
                {t('anon.hostedBy', { title: scheduledModalData.title || scheduledModalData.roomName, host: scheduledModalData.createdByMember?.fullName || 'Host' })}
              </p>
              <p className={styles.scheduledMeta}>
                {t('anon.scheduledFor')} <strong>{new Date(scheduledModalData.scheduledFor).toLocaleString()}</strong>
              </p>
              {scheduledDiffMs > 60 * 60 * 1000 ? (
                <p className={styles.scheduledNote}>{t('anon.moreThanHour')}</p>
              ) : (
                <div className={styles.scheduledFoot}>
                  <div>
                    <div className={styles.scheduledCountLabel}>{t('anon.startingIn')}</div>
                    <div className={styles.scheduledCount}>{countdown}</div>
                  </div>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnFill}`}
                    onClick={() => {
                      router.push(`/rooms/${scheduledModalData.roomName}`);
                      setScheduledModalData(null);
                    }}
                  >
                    {t('anon.joinAnyway')}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className={styles.anonDivider} />
          <p className={styles.anonFootText}>
            {t('anon.hostPrivilege')}
            <button type="button" className={styles.linkBtn} onClick={onSignIn}>
              {t('anon.signInHere')}
            </button>
          </p>
          <p className={styles.anonFootText}>
            {t('anon.noAccount')}
            <button type="button" className={styles.linkBtn} onClick={onSignUp}>
              {t('nav.signUp')}
            </button>
          </p>

          {/* Download Desktop App - hidden on mobile */}
          <div className={`${styles.downloadRow} ${styles.mobileHidden}`}>
            <span className={styles.anonFootText}>{t('nav.downloadDesktop')}</span>
            <a
              href="/api/download?os=win"
              className={styles.downloadBtn}
              id="download-desktop-app-btn"
              title="Download Kloud Meet for Windows"
            >
              <svg className={styles.downloadBtnIcon} viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
                <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
              </svg>
              <span className={styles.downloadBtnLabel}>Windows App</span>
              <svg className={styles.downloadBtnArrow} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" aria-hidden="true">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </a>

            {MAC_APP_AVAILABLE && (
            <a
              href="/api/download?os=mac"
              className={styles.downloadBtn}
              id="download-desktop-app-mac-btn"
              title="Download Kloud Meet for Mac"
            >
              <svg className={styles.downloadBtnIcon} viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <circle cx="12" cy="12" r="12" fill="currentColor" />
                <path d="M13.2 6.5h-2.4l-4.5 11h2.3l1.2-3.2h4.4l1.2 3.2h2.3l-4.5-11zm-2.8 6.2l1.6-4.3 1.6 4.3h-3.2z" fill="#fff" />
              </svg>
              <span className={styles.downloadBtnLabel}>macOS App</span>
              <svg className={styles.downloadBtnArrow} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" aria-hidden="true">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </a>
            )}
          </div>
        </section>

        {/* ── Right: illustration carousel ── */}
        <section
          className={styles.carousel}
          aria-roledescription="carousel"
          aria-label={tx('anon.carousel.label', 'What you can do')}
        >
          <div className={styles.carouselStage}>
            <button
              type="button"
              className={styles.carouselArrow}
              onClick={() => goToSlide(slide - 1)}
              aria-label={tx('anon.carousel.prev', 'Previous')}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <div className={styles.carouselCircle} aria-hidden="true">
              <div key={slide} className={styles.carouselSlide}>
                <SlideArt index={slide} />
              </div>
            </div>
            <button
              type="button"
              className={styles.carouselArrow}
              onClick={() => goToSlide(slide + 1)}
              aria-label={tx('anon.carousel.next', 'Next')}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          </div>
          <div
            className={styles.carouselCaption}
            aria-roledescription="slide"
            aria-live={autoPlay ? 'off' : 'polite'}
          >
            <h2 className={styles.carouselTitle}>{slides[slide].title}</h2>
            <p className={styles.carouselDesc}>{slides[slide].desc}</p>
          </div>
          <div className={styles.carouselDots}>
            {slides.map((s, i) => (
              <button
                key={i}
                type="button"
                className={`${styles.carouselDot}${i === slide ? ` ${styles.carouselDotActive}` : ''}`}
                onClick={() => goToSlide(i)}
                aria-label={s.title}
                aria-current={i === slide ? 'true' : undefined}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
