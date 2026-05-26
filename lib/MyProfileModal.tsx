import React, { useState, useEffect, useRef } from 'react';
import styles from '../styles/MyProfileModal.module.css';
import { useI18n } from './i18n';

/** API PUT /api/account/profile 校验错误码 → i18n key */
const PROFILE_PUT_ERROR_I18N: Record<string, string> = {
  PERSONAL_ROOM_ID_INVALID: 'profile.roomIdInvalid',
  PERSONAL_ROOM_ID_TAKEN: 'profile.roomIdTaken',
  EMAIL_INVALID: 'profile.emailInvalid',
  EMAIL_IN_USE: 'profile.emailInUse',
  PHONE_INVALID: 'profile.phoneInvalid',
};

function profilePutErrorMessage(
  data: { error?: string; code?: string },
  t: (key: string) => string,
): string {
  const i18nKey = data.code ? PROFILE_PUT_ERROR_I18N[data.code] : undefined;
  if (i18nKey) return t(i18nKey);
  return data.error || t('profile.saveFailed');
}

interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  token: string;
}

export function MyProfileModal({
  user,
  onClose,
  onSave,
  toast,
}: {
  user: AuthUser;
  onClose: () => void;
  onSave?: (data: { personalRoomId: string; avatarUrl?: string; displayName?: string }) => void;
  toast?: { show: (m: string) => void };
}) {
  const [loading, setLoading] = useState(true);
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [biography, setBiography] = useState('');
  const [personalRoomId, setPersonalRoomId] = useState('');
  const [personalRoomEnabled, setPersonalRoomEnabled] = useState(false);
  const [showRoomIdDialog, setShowRoomIdDialog] = useState(false);
  const [draftRoomId, setDraftRoomId] = useState('');
  const [roomIdDialogError, setRoomIdDialogError] = useState('');
  const [roomIdDialogSaving, setRoomIdDialogSaving] = useState(false);
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [emailVerified, setEmailVerified] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  
  // Password change state
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  
  // Phone edit state
  const [editingPhone, setEditingPhone] = useState(false);
  
  // Avatar upload ref
  const avatarInputRef = useRef<HTMLInputElement>(null);
  
  // Track focused state for styling the email group
  const [emailFocused, setEmailFocused] = useState(false);

  // Animate in
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  useEffect(() => {
    fetch('/api/account/profile', {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.error) {
          setFirstName(data.firstName || '');
          setMiddleName(data.middleName || '');
          setLastName(data.lastName || '');
          setEmail(data.email || '');
          setUsername(data.username || '');
          setPhone(data.phone || '');
          setBiography(data.biography || '');
          const roomId = data.personalRoomId || '';
          setPersonalRoomId(roomId);
          setPersonalRoomEnabled(!!roomId);
          setAvatarUrl(data.avatarUrl || '');
          setEmailVerified(data.emailVerified || false);
          setPhoneVerified(data.phoneVerified || false);
        }
      })
      .catch((err) => {
        console.error(err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [user.token]);

  const handleSave = async () => {
    setSaving(true);
    setError('');

    if (personalRoomEnabled && !personalRoomId.trim()) {
      setError(t('profile.roomIdRequired'));
      setSaving(false);
      return;
    }

    try {
      const res = await fetch('/api/account/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({
          firstName,
          middleName,
          lastName,
          biography,
          personalRoomId: personalRoomEnabled ? personalRoomId : null,
          phone,
          email,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(profilePutErrorMessage(data, t));
        setSaving(false);
        return;
      }
      toast?.show(t('profile.saved'));
      
      // Notify parent with new data so UI updates in real-time
      const newDisplayName = [firstName, lastName].filter(Boolean).join(' ') || username;
      onSave?.({
        personalRoomId: personalRoomEnabled ? personalRoomId : '',
        avatarUrl: avatarUrl || undefined,
        displayName: newDisplayName,
      });
      
      // Sync into localStorage so avatar persists after page refresh
      try {
        const stored = localStorage.getItem('kloudUser');
        if (stored) {
          const parsed = JSON.parse(stored);
          parsed.displayName = newDisplayName;
          if (avatarUrl) parsed.avatarUrl = avatarUrl;
          localStorage.setItem('kloudUser', JSON.stringify(parsed));
        }
      } catch {}
      
      onClose();
    } catch (err) {
      console.error(err);
      setError(t('profile.networkError'));
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordError('');
    
    if (!currentPassword) {
      setPasswordError(t('profile.enterCurrentPassword'));
      return;
    }
    if (!newPassword) {
      setPasswordError(t('profile.enterNewPassword'));
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 30) {
      setPasswordError(t('profile.passwordLengthError'));
      return;
    }
    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setPasswordError(t('profile.passwordFormatError'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('profile.passwordMismatch'));
      return;
    }

    setPasswordSaving(true);
    try {
      const res = await fetch('/api/account/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPasswordError(data.error || t('profile.passwordChangeFailed'));
        setPasswordSaving(false);
        return;
      }
      toast?.show(t('profile.passwordChanged'));
      setShowPasswordForm(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      console.error(err);
      setPasswordError(t('profile.networkError'));
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleAvatarClick = () => {
    avatarInputRef.current?.click();
  };

  const [avatarUploading, setAvatarUploading] = useState(false);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type and size
    if (!file.type.startsWith('image/')) {
      toast?.show(t('profile.avatarInvalidType'));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast?.show(t('profile.avatarTooLarge'));
      return;
    }

    // Show local preview immediately
    const reader = new FileReader();
    reader.onload = (ev) => {
      setAvatarUrl(ev.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Upload to S3 via API
    setAvatarUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/account/avatar', {
        method: 'POST',
        headers: { Authorization: `Bearer ${user.token}` },
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        toast?.show(data.error || t('profile.avatarUploadFailed'));
        return;
      }

      // Update avatar with the real S3 URL
      setAvatarUrl(data.avatarUrl);
      toast?.show(t('profile.avatarUpdated'));
      
      // Immediately propagate to parent so top-right avatar refreshes without closing modal
      onSave?.({ personalRoomId, avatarUrl: data.avatarUrl });
      // Sync localStorage now so it's available even if user doesn't press Save
      try {
        const stored = localStorage.getItem('kloudUser');
        if (stored) {
          const parsed = JSON.parse(stored);
          parsed.avatarUrl = data.avatarUrl;
          localStorage.setItem('kloudUser', JSON.stringify(parsed));
        }
      } catch {}
    } catch (err) {
      console.error(err);
      toast?.show(t('profile.avatarUploadFailed'));
    } finally {
      setAvatarUploading(false);
      // Reset input so same file can be re-selected
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 200);
  };

  const openRoomIdDialog = () => {
    setDraftRoomId('');
    setRoomIdDialogError('');
    setShowRoomIdDialog(true);
  };

  const closeRoomIdDialog = () => {
    setShowRoomIdDialog(false);
    setDraftRoomId('');
    setRoomIdDialogError('');
  };

  const validateRoomId = (id: string) =>
    /^(?=.*[a-zA-Z])[a-zA-Z0-9]{3,12}$/.test(id);

  const handleConfirmRoomId = async () => {
    const trimmed = draftRoomId.trim();
    if (!trimmed) {
      setRoomIdDialogError(t('profile.roomIdRequired'));
      return;
    }
    if (!validateRoomId(trimmed)) {
      setRoomIdDialogError(t('profile.roomIdInvalid'));
      return;
    }
    if (trimmed === personalRoomId) {
      closeRoomIdDialog();
      return;
    }

    setRoomIdDialogSaving(true);
    setRoomIdDialogError('');
    try {
      const res = await fetch('/api/account/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({ personalRoomId: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRoomIdDialogError(profilePutErrorMessage(data, t));
        return;
      }
      setPersonalRoomId(trimmed);
      onSave?.({ personalRoomId: trimmed, avatarUrl: avatarUrl || undefined });
      closeRoomIdDialog();
      toast?.show(t('profile.saved'));
    } catch (err) {
      console.error(err);
      setRoomIdDialogError(t('profile.networkError'));
    } finally {
      setRoomIdDialogSaving(false);
    }
  };

  const displayName = [firstName, lastName].filter(Boolean).join(' ') || username;

  // Loading skeleton
  if (loading) {
    return (
      <div className={`${styles.modalOverlay} ${visible ? styles.overlayVisible : ''}`}>
        <div className={`${styles.modalContent} ${visible ? styles.contentVisible : ''}`}>
          <div className={styles.headerActions}>
            <div className={styles.skeletonBtn} />
            <div className={styles.skeletonBtn} />
          </div>
          <div className={styles.bodyContent}>
            <div className={styles.topSection}>
              <div className={styles.leftCol}>
                <div className={`${styles.avatarWrapper} ${styles.skeleton}`} />
                <div className={styles.skeletonLine} style={{ width: '100px' }} />
              </div>
              <div className={styles.rightCol}>
                {[1,2,3,4,5].map(i => (
                  <div key={i} className={styles.formRow}>
                    <div className={styles.skeletonLine} style={{ width: '120px' }} />
                    <div className={styles.skeletonLine} style={{ flex: 1 }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.modalOverlay} ${visible ? styles.overlayVisible : ''}`} onClick={handleClose}>
      <div className={`${styles.modalContent} ${visible ? styles.contentVisible : ''}`} onClick={e => e.stopPropagation()}>
        
        {/* Header with title + Actions */}
        <div className={styles.headerBar}>
          <div className={styles.headerTitle}>{t('nav.myProfile')}</div>
          <div className={styles.headerActions}>
            <button 
              className={styles.btnSave} 
              onClick={handleSave} 
              disabled={saving || loading}
            >
              {saving ? (
                <><span className={styles.spinnerSmall} /> {t('common.saving')}</>
              ) : (
                <>{/* Save icon */}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                    <polyline points="17 21 17 13 7 13 7 21"/>
                    <polyline points="7 3 7 8 15 8"/>
                  </svg>
                  {t('common.save')}
                </>
              )}
            </button>
            <button 
              className={styles.btnCancel} 
              onClick={handleClose} 
              disabled={saving}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>

        {/* Form Body */}
        <div className={styles.bodyContent}>
          {error && (
            <div className={styles.errorBanner}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
              {error}
            </div>
          )}
          
          <div className={styles.topSection}>
            {/* Left Column (Avatar) */}
            <div className={styles.leftCol}>
              <div
                className={styles.avatarWrapper}
                onClick={avatarUploading ? undefined : handleAvatarClick}
                title={t('profile.changeAvatar')}
                style={{ cursor: avatarUploading ? 'wait' : 'pointer' }}
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Avatar" className={styles.avatarImg} />
                ) : (
                  <span className={styles.avatarInitial}>{(firstName?.[0] || lastName?.[0] || username?.[0] || 'U').toUpperCase()}</span>
                )}
                <div className={`${styles.avatarOverlay} ${avatarUploading ? styles.avatarOverlayVisible : ''}`}>
                  {avatarUploading ? (
                    <span className={styles.spinnerMedium} />
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                      <circle cx="12" cy="13" r="4"/>
                    </svg>
                  )}
                </div>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleAvatarChange}
                />
              </div>
              <div className={styles.avatarName}>{displayName}</div>
              <div className={styles.avatarUsername}>@{username}</div>
            </div>

            {/* Right Column (Fields) */}
            <div className={styles.rightCol}>
              
              <div className={styles.formRow}>
                <div className={styles.formLabel}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  {t('profile.loginName')}
                </div>
                <div className={styles.formField}>
                  <div className={styles.readOnlyText}>{username}</div>
                </div>
              </div>

              <div className={styles.formRow}>
                <div className={styles.formLabel}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  {t('profile.name')}
                </div>
                <div className={styles.formField}>
                  <input 
                    className={styles.inputBox} 
                    placeholder={t('profile.firstName')} 
                    value={firstName} 
                    onChange={e => setFirstName(e.target.value)} 
                  />
                  <input 
                    className={styles.inputBox} 
                    placeholder={t('profile.middleName')} 
                    value={middleName} 
                    onChange={e => setMiddleName(e.target.value)} 
                  />
                  <input 
                    className={styles.inputBox} 
                    placeholder={t('profile.lastName')} 
                    value={lastName} 
                    onChange={e => setLastName(e.target.value)} 
                  />
                </div>
              </div>

              <div className={`${styles.formRow} ${styles.personalRoomFormRow}`}>
                <div className={styles.formLabel} aria-hidden="true" />
                <div className={styles.formField}>
                  <div className={styles.personalRoomRow}>
                    <label className={styles.personalRoomCheckbox}>
                      <input
                        type="checkbox"
                        checked={personalRoomEnabled}
                        onChange={(e) => setPersonalRoomEnabled(e.target.checked)}
                      />
                      {t('profile.supportPersonalRoom')}
                    </label>
                    {personalRoomEnabled && (
                      <>
                        <input
                          className={`${styles.inputBox} ${styles.inputBoxReadOnly}`}
                          readOnly
                          aria-readonly="true"
                          placeholder={t('profile.roomIdHint')}
                          value={personalRoomId}
                          tabIndex={-1}
                        />
                        <button
                          type="button"
                          className={styles.roomIdMoreBtn}
                          onClick={openRoomIdDialog}
                          title={t('profile.changeRoomIdTitle')}
                          aria-label={t('profile.changeRoomIdTitle')}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="5" cy="12" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="19" cy="12" r="2" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className={styles.formRow}>
                <div className={styles.formLabel}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  {t('profile.email')}
                </div>
                <div className={styles.formField}>
                  <div className={`${styles.inputGroup} ${emailFocused ? styles.focused : ''}`}>
                    <input 
                      className={styles.inputBox} 
                      placeholder={t('profile.emailPlaceholder')} 
                      value={email} 
                      onChange={e => setEmail(e.target.value)}
                      onFocus={() => setEmailFocused(true)}
                      onBlur={() => setEmailFocused(false)}
                      style={{ background: 'transparent' }}
                    />
                    {email && (
                      emailVerified ? (
                        <span className={styles.verifiedBadge}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                          {t('profile.verified')}
                        </span>
                      ) : (
                        <span className={styles.notVerifiedText}>{t('profile.notVerified')}</span>
                      )
                    )}
                  </div>
                </div>
              </div>

              <div className={styles.formRow}>
                <div className={styles.formLabel}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>
                  {t('profile.biography')}
                </div>
                <div className={styles.formField}>
                  <div className={styles.textareaWrap}>
                    <textarea 
                      className={styles.textareaBox} 
                      placeholder={t('profile.biographyPlaceholder')}
                      maxLength={160}
                      value={biography}
                      onChange={e => setBiography(e.target.value)}
                    />
                    <div className={styles.charCount}>{biography.length}/160</div>
                  </div>
                </div>
              </div>
              
            </div>
          </div>

          {/* Account Security Divider */}
          <div className={styles.dividerContainer}>
            <div className={styles.dividerIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <div className={styles.dividerText}>{t('profile.accountSecurity')}</div>
            <div className={styles.dividerLine} />
          </div>

          {/* Bottom Section (Security) */}
          <div className={styles.securitySection}>
            {/* Phone */}
            <div className={styles.formRow}>
              <div className={styles.formLabel}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                {t('profile.primaryPhone')}
              </div>
              <div className={styles.changeBtnWrapper}>
                {editingPhone ? (
                  <input
                    className={styles.inputBox}
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+1 (555) 123-4567"
                    autoFocus
                    onBlur={() => setEditingPhone(false)}
                    style={{ maxWidth: '250px' }}
                  />
                ) : (
                  <div className={styles.securityValue}>
                    {phone || t('common.none')}
                    {phone && phoneVerified && (
                      <span className={styles.verifiedBadge}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                      </span>
                    )}
                  </div>
                )}
                <button 
                  className={styles.btnChange}
                  onClick={() => setEditingPhone(true)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                  {t('common.edit')}
                </button>
              </div>
            </div>

            {/* Password */}
            <div className={styles.formRow}>
              <div className={styles.formLabel}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                {t('profile.password')}
              </div>
              <div className={styles.changeBtnWrapper}>
                {!showPasswordForm ? (
                  <>
                    <div className={styles.securityValue} style={{ letterSpacing: '3px' }}>••••••••</div>
                    <button 
                      className={styles.btnChange}
                      onClick={() => setShowPasswordForm(true)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                      </svg>
                      {t('common.change')}
                    </button>
                  </>
                ) : (
                  <div className={styles.passwordForm}>
                    {passwordError && (
                      <div className={styles.passwordError}>{passwordError}</div>
                    )}
                    <div className={styles.passwordInputWrap}>
                      <input 
                        className={styles.inputBox}
                        type={showCurrentPwd ? 'text' : 'password'}
                        placeholder={t('profile.currentPassword')}
                        value={currentPassword}
                        onChange={e => setCurrentPassword(e.target.value)}
                        autoFocus
                      />
                      <button 
                        type="button" 
                        className={styles.eyeBtn} 
                        onClick={() => setShowCurrentPwd(!showCurrentPwd)}
                        tabIndex={-1}
                      >
                        {showCurrentPwd ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/></svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        )}
                      </button>
                    </div>
                    <div className={styles.passwordInputWrap}>
                      <input 
                        className={styles.inputBox}
                        type={showNewPwd ? 'text' : 'password'}
                        placeholder={t('profile.newPassword')}
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                      />
                      <button 
                        type="button" 
                        className={styles.eyeBtn} 
                        onClick={() => setShowNewPwd(!showNewPwd)}
                        tabIndex={-1}
                      >
                        {showNewPwd ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/></svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        )}
                      </button>
                    </div>
                    <input 
                      className={styles.inputBox}
                      type="password"
                      placeholder={t('profile.confirmNewPassword')}
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                    />
                    <div className={styles.passwordHint}>{t('profile.passwordHint')}</div>
                    <div className={styles.passwordActions}>
                      <button 
                        className={styles.btnSavePassword}
                        onClick={handleChangePassword}
                        disabled={passwordSaving}
                      >
                        {passwordSaving ? t('common.saving') : t('profile.updatePassword')}
                      </button>
                      <button 
                        className={styles.btnCancelPassword}
                        onClick={() => {
                          setShowPasswordForm(false);
                          setCurrentPassword('');
                          setNewPassword('');
                          setConfirmPassword('');
                          setPasswordError('');
                        }}
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>

        {showRoomIdDialog && (
          <div
            className={styles.roomIdSubOverlay}
            onClick={closeRoomIdDialog}
          >
            <div
              className={styles.roomIdSubDialog}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-labelledby="change-room-id-title"
            >
              <div className={styles.roomIdSubHeader}>
                <h3 id="change-room-id-title" className={styles.roomIdSubTitle}>
                  {t('profile.changeRoomIdTitle')}
                </h3>
                <div className={styles.roomIdSubHeaderActions}>
                  <button
                    type="button"
                    className={styles.btnSave}
                    onClick={handleConfirmRoomId}
                    disabled={roomIdDialogSaving}
                  >
                    {roomIdDialogSaving ? t('common.saving') : t('common.change')}
                  </button>
                  <button
                    type="button"
                    className={styles.btnCancel}
                    onClick={closeRoomIdDialog}
                    disabled={roomIdDialogSaving}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>

              <div className={styles.roomIdSubBody}>
                <div className={styles.roomIdSubRow}>
                  <div className={styles.roomIdSubLabel}>{t('profile.currentRoomId')}</div>
                  <div className={styles.roomIdSubCurrentValue}>
                    {personalRoomId || '—'}
                  </div>
                </div>
                <div className={styles.roomIdSubRow}>
                  <div className={styles.roomIdSubLabel}>
                    <span className={styles.roomIdRequired}>*</span>
                    {t('profile.newRoomId')}
                  </div>
                  <input
                    className={styles.inputBox}
                    placeholder={t('profile.roomIdNewHint')}
                    maxLength={12}
                    value={draftRoomId}
                    onChange={(e) =>
                      setDraftRoomId(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))
                    }
                    autoFocus
                  />
                </div>
                {roomIdDialogError && (
                  <div className={styles.roomIdSubError}>{roomIdDialogError}</div>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
