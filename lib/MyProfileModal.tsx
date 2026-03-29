import React, { useState, useEffect } from 'react';
import styles from '../styles/MyProfileModal.module.css';

interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  token: string;
}

export function MyProfileModal({
  user,
  onClose,
  toast,
}: {
  user: AuthUser;
  onClose: () => void;
  toast?: { show: (m: string) => void };
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [biography, setBiography] = useState('');
  const [personalRoomId, setPersonalRoomId] = useState('');
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  
  // Track focused state for styling the email group
  const [emailFocused, setEmailFocused] = useState(false);

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
          setPersonalRoomId(data.personalRoomId || '');
          setAvatarUrl(data.avatarUrl || '');
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
          personalRoomId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to update profile');
        setSaving(false);
        return;
      }
      toast?.show('Profile saved successfully!');
      
      // Update local storage slightly to reflect DisplayName change
      const stored = localStorage.getItem('kloudUser');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          const nameStr = [firstName, lastName].filter(Boolean).join(' ');
          parsed.displayName = nameStr || username;
          localStorage.setItem('kloudUser', JSON.stringify(parsed));
        } catch {}
      }
      
      onClose();
    } catch (err) {
      console.error(err);
      setError('Network error saving profile.');
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalContent}>
        
        {/* Header Actions */}
        <div className={styles.headerActions}>
          <button 
            className={styles.btnSave} 
            onClick={handleSave} 
            disabled={saving || loading}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button 
            className={styles.btnCancel} 
            onClick={onClose} 
            disabled={saving}
          >
            Cancel
          </button>
        </div>

        {/* Form Body */}
        <div className={styles.bodyContent}>
          {error && (
            <div style={{ padding: '12px', background: '#fef2f2', color: '#b91c1c', borderRadius: '6px', fontSize: '0.9rem' }}>
              {error}
            </div>
          )}
          
          <div className={styles.topSection}>
            {/* Left Column (Avatar) */}
            <div className={styles.leftCol}>
              <div className={styles.avatarWrapper}>
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Avatar" className={styles.avatarImg} />
                ) : (
                  <span>{(firstName?.[0] || lastName?.[0] || username?.[0] || 'U').toUpperCase()}</span>
                )}
              </div>
              <div className={styles.avatarName}>
                {[firstName, lastName].filter(Boolean).join(' ') || username}
              </div>
            </div>

            {/* Right Column (Fields) */}
            <div className={styles.rightCol}>
              
              <div className={styles.formRow}>
                <div className={styles.formLabel}>Login Name</div>
                <div className={styles.formField}>
                  <div className={styles.readOnlyText}>{username}</div>
                </div>
              </div>

              <div className={styles.formRow}>
                <div className={styles.formLabel}>Name:</div>
                <div className={styles.formField}>
                  <input 
                    className={styles.inputBox} 
                    placeholder="First Name" 
                    value={firstName} 
                    onChange={e => setFirstName(e.target.value)} 
                    disabled={loading}
                  />
                  <input 
                    className={styles.inputBox} 
                    placeholder="Middle Name" 
                    value={middleName} 
                    onChange={e => setMiddleName(e.target.value)} 
                    disabled={loading}
                  />
                  <input 
                    className={styles.inputBox} 
                    placeholder="Last Name" 
                    value={lastName} 
                    onChange={e => setLastName(e.target.value)} 
                    disabled={loading}
                  />
                </div>
              </div>

              <div className={styles.formRow}>
                <div className={styles.formLabel}>My Meeting Room ID:</div>
                <div className={styles.formField}>
                  <input 
                    className={styles.inputBox} 
                    placeholder="3-12 characters and digits" 
                    maxLength={12}
                    value={personalRoomId} 
                    onChange={e => setPersonalRoomId(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))} 
                    disabled={loading}
                  />
                </div>
              </div>

              <div className={styles.formRow}>
                <div className={styles.formLabel}>Email:</div>
                <div className={styles.formField}>
                  <div className={`${styles.inputGroup} ${emailFocused ? styles.focused : ''}`}>
                    <input 
                      className={styles.inputBox} 
                      placeholder="Please enter your email" 
                      value={email} 
                      onFocus={() => setEmailFocused(true)}
                      onBlur={() => setEmailFocused(false)}
                      readOnly // Currently read-only as verified
                      disabled={loading}
                      style={{ background: 'transparent' }}
                    />
                    <span className={styles.notVerifiedText}>Not verified</span>
                  </div>
                  <button className={styles.btnVerify} type="button" onClick={() => toast?.show('Email verification coming soon')}>Verify</button>
                </div>
              </div>

              <div className={styles.formRow}>
                <div className={styles.formLabel}>Biography</div>
                <div className={styles.formField}>
                  <textarea 
                    className={styles.textareaBox} 
                    placeholder="Enter some information about yourself, up to 160 characters"
                    maxLength={160}
                    value={biography}
                    onChange={e => setBiography(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>
              
            </div>
          </div>

          {/* Account Security Divider */}
          <div className={styles.dividerContainer}>
            <div className={styles.dividerText}>Account Security</div>
            <div className={styles.dividerLine} />
          </div>

          {/* Bottom Section (Security) */}
          <div className={styles.securitySection}>
            <div className={styles.formRow}>
              <div className={styles.formLabel}>Primary Phone:</div>
              <div className={styles.changeBtnWrapper}>
                <input 
                  className={styles.inputBox}
                  value={phone || 'None'} 
                  disabled
                  style={{ maxWidth: '250px' }}
                />
                <button 
                  className={styles.btnChange} 
                  onClick={() => toast?.show('Phone change coming soon')}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                  Change
                </button>
              </div>
            </div>

            <div className={styles.formRow}>
              <div className={styles.formLabel}>Password:</div>
              <div className={styles.changeBtnWrapper}>
                <input 
                  className={styles.inputBox} 
                  type="password"
                  value="********" 
                  disabled
                  style={{ maxWidth: '250px', letterSpacing: '2px' }}
                />
                <button 
                  className={styles.btnChange} 
                  onClick={() => toast?.show('Password change coming soon')}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                  Change
                </button>
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
