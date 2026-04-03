import React, { useState, useEffect } from 'react';
import styles from '../styles/SystemSettingsModal.module.css';

interface SystemSettingsModalProps {
  onClose: () => void;
  onSave: () => void;
}

type TabType = 'general' | 'aws' | 'livekit' | 'telnyx';

export function SystemSettingsModal({ onClose, onSave }: SystemSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('general');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // General Settings
  const [orgName, setOrgName] = useState('');
  
  // AWS Settings
  const [awsAccessKey, setAwsAccessKey] = useState('');
  const [awsSecretKey, setAwsSecretKey] = useState('');
  const [awsRegion, setAwsRegion] = useState('');
  const [awsBucket, setAwsBucket] = useState('');

  // LiveKit Settings
  const [livekitUrl, setLivekitUrl] = useState('');
  const [livekitApiKey, setLivekitApiKey] = useState('');
  const [livekitApiSecret, setLivekitApiSecret] = useState('');

  // Telnyx Settings
  const [telnyxAppKey, setTelnyxAppKey] = useState('');

  // Load settings from API on mount
  useEffect(() => {
    setIsLoading(true);
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data === 'object' && !data.error) {
          setOrgName(data.org_name || '');
          setAwsAccessKey(data.aws_access_key || '');
          setAwsSecretKey(data.aws_secret_key || '');
          setAwsRegion(data.aws_region || '');
          setAwsBucket(data.aws_bucket || '');
          setLivekitUrl(data.livekit_url || '');
          setLivekitApiKey(data.livekit_api_key || '');
          setLivekitApiSecret(data.livekit_api_secret || '');
          setTelnyxAppKey(data.telnyx_app_key || '');
        }
      })
      .catch((err) => console.error('Failed to load settings:', err))
      .finally(() => setIsLoading(false));
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_name: orgName,
          aws_access_key: awsAccessKey,
          aws_secret_key: awsSecretKey,
          aws_region: awsRegion,
          aws_bucket: awsBucket,
          livekit_url: livekitUrl,
          livekit_api_key: livekitApiKey,
          livekit_api_secret: livekitApiSecret,
          telnyx_app_key: telnyxAppKey,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        console.error('Save settings error:', err);
      }
      onSave();
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>System Settings</h2>
            <p className={styles.subtitle}>Configure global platform connectivity and credentials.</p>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className={styles.layout}>
          {/* Sidebar Tabs */}
          <div className={styles.sidebar}>
            <button 
              className={activeTab === 'general' ? styles.tabActive : styles.tab} 
              onClick={() => setActiveTab('general')}
            >
              General
            </button>
            <button 
              className={activeTab === 'aws' ? styles.tabActive : styles.tab} 
              onClick={() => setActiveTab('aws')}
            >
              AWS S3 Storage
            </button>
            <button 
              className={activeTab === 'livekit' ? styles.tabActive : styles.tab} 
              onClick={() => setActiveTab('livekit')}
            >
              LiveKit Server
            </button>
            <button 
              className={activeTab === 'telnyx' ? styles.tabActive : styles.tab} 
              onClick={() => setActiveTab('telnyx')}
            >
              Telnyx / Messaging
            </button>
          </div>

          {/* Main Content Area */}
          <div className={styles.contentArea}>
            {isLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem', color: '#9ca3af' }}>
                Loading settings...
              </div>
            ) : (
              <>
                {activeTab === 'general' && (
                  <div className={styles.formGroup}>
                    <h3 className={styles.sectionTitle}>General Settings</h3>
                    <div className={styles.inputRow}>
                      <label className={styles.label}>Organization Name</label>
                      <input 
                        type="text" 
                        className={styles.input} 
                        value={orgName} 
                        onChange={e => setOrgName(e.target.value)} 
                        placeholder="e.g. Acme Corp" 
                      />
                      <p className={styles.helperText}>This name appears on the dashboard and email templates.</p>
                    </div>
                  </div>
                )}

                {activeTab === 'aws' && (
                  <div className={styles.formGroup}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
                      <svg viewBox="0 0 24 24" fill="#ff9900" width="24" height="24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z"/>
                      </svg>
                      <h3 className={styles.sectionTitle} style={{ margin: 0 }}>AWS Storage Keys</h3>
                    </div>
                    
                    <div className={styles.alertBox}>
                      <strong>Security Note:</strong> These credentials securely grant KloudMeet access to S3 for processing Egress recordings. They are encrypted at rest.
                    </div>

                    <div className={styles.inputRow} style={{ marginTop: '1.5rem' }}>
                      <label className={styles.label}>AWS Access Key ID</label>
                      <input 
                        type="text" 
                        className={styles.input} 
                        value={awsAccessKey} 
                        onChange={e => setAwsAccessKey(e.target.value)} 
                        placeholder="AKIAIOSFODNN7EXAMPLE" 
                      />
                    </div>
                    <div className={styles.inputRow}>
                      <label className={styles.label}>AWS Secret Access Key</label>
                      <input 
                        type="password" 
                        className={styles.input} 
                        value={awsSecretKey} 
                        onChange={e => setAwsSecretKey(e.target.value)} 
                        placeholder="••••••••••••••••••••••••••••••••••••••••" 
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div className={styles.inputRow}>
                        <label className={styles.label}>AWS Region</label>
                        <input 
                          type="text" 
                          className={styles.input} 
                          value={awsRegion} 
                          onChange={e => setAwsRegion(e.target.value)} 
                          placeholder="us-east-1" 
                        />
                      </div>
                      <div className={styles.inputRow}>
                        <label className={styles.label}>S3 Bucket Name</label>
                        <input 
                          type="text" 
                          className={styles.input} 
                          value={awsBucket} 
                          onChange={e => setAwsBucket(e.target.value)} 
                          placeholder="my-company-recordings" 
                        />
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'livekit' && (
                  <div className={styles.formGroup}>
                    <h3 className={styles.sectionTitle}>LiveKit Server</h3>
                    <p className={styles.helperText} style={{ marginBottom: '1.5rem' }}>Configure connection strings for the realtime video infrastructure.</p>
                    
                    <div className={styles.inputRow}>
                      <label className={styles.label}>LiveKit URL</label>
                      <input 
                        type="text" 
                        className={styles.input} 
                        value={livekitUrl} 
                        onChange={e => setLivekitUrl(e.target.value)} 
                        placeholder="wss://your-instance.livekit.cloud" 
                      />
                    </div>
                    <div className={styles.inputRow}>
                      <label className={styles.label}>API Key</label>
                      <input 
                        type="text" 
                        className={styles.input} 
                        value={livekitApiKey} 
                        onChange={e => setLivekitApiKey(e.target.value)} 
                        placeholder="APIxxxxxxxxxxxx" 
                      />
                    </div>
                    <div className={styles.inputRow}>
                      <label className={styles.label}>API Secret</label>
                      <input 
                        type="password" 
                        className={styles.input} 
                        value={livekitApiSecret} 
                        onChange={e => setLivekitApiSecret(e.target.value)} 
                        placeholder="••••••••••••••••••••••••••••••••••••••••" 
                      />
                    </div>
                  </div>
                )}

                {activeTab === 'telnyx' && (
                  <div className={styles.formGroup}>
                    <h3 className={styles.sectionTitle}>Telnyx / Messaging</h3>
                    <p className={styles.helperText} style={{ marginBottom: '1.5rem' }}>Configure API access for SMS invitations and telephony.</p>
                    
                    <div className={styles.inputRow}>
                      <label className={styles.label}>Telnyx App Key</label>
                      <input 
                        type="password" 
                        className={styles.input} 
                        value={telnyxAppKey} 
                        onChange={e => setTelnyxAppKey(e.target.value)} 
                        placeholder="••••••••••••••••••••••••••••••••••••••••" 
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button className={styles.btnOutline} onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button className={styles.btnSolid} onClick={handleSave} disabled={isSaving || isLoading}>
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
