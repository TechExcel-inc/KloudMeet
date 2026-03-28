import React, { useState } from 'react';
import { generateRoomId } from '@/lib/client-utils';
import styles from '../styles/ScheduleMeetingModal.module.css';

type TabType = 'general' | 'emails' | 'ai' | 'linked';

interface ScheduleMeetingModalProps {
  user: any;
  existingMeeting?: any;
  onClose: () => void;
  onSave: () => void;
}

export function ScheduleMeetingModal({ user, existingMeeting, onClose, onSave }: ScheduleMeetingModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('general');
  const [subModal, setSubModal] = useState<'invite' | 'reminder' | null>(null);

  const [title, setTitle] = useState(existingMeeting?.title || `${user?.displayName || 'User'}'s Meeting`);
  const [description, setDescription] = useState(existingMeeting?.description || '');
  
  const initDate = existingMeeting?.scheduledFor 
    ? new Date(existingMeeting.scheduledFor).toISOString().split('T')[0] 
    : new Date().toISOString().split('T')[0];
  const initTime = existingMeeting?.scheduledFor 
    ? new Date(existingMeeting.scheduledFor).toTimeString().substring(0, 5) 
    : '20:00';
    
  const [date, setDate] = useState(initDate);
  const [time, setTime] = useState(initTime);
  
  let initDurStr = '30min';
  if (existingMeeting?.durationMinutes) {
     if (existingMeeting.durationMinutes === 15) initDurStr = '15min';
     if (existingMeeting.durationMinutes === 30) initDurStr = '30min';
     if (existingMeeting.durationMinutes === 45) initDurStr = '45min';
     if (existingMeeting.durationMinutes === 60) initDurStr = '60min';
     if (existingMeeting.durationMinutes === 90) initDurStr = '90min(1.5h)';
     if (existingMeeting.durationMinutes === 120) initDurStr = '120min(2h)';
     if (existingMeeting.durationMinutes === 180) initDurStr = '180min(3h)';
     if (existingMeeting.durationMinutes === 240) initDurStr = '240min(4h)';
  }
  const [durationStr, setDurationStr] = useState(initDurStr);
  
  const [isSaving, setIsSaving] = useState(false);

  // Timezone display (Forced to US Pacific Time)
  const tzString = '(GMT-08:00) Pacific Time (US & Canada)';

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const roomName = generateRoomId();
      
      const scheduledFor = new Date(`${date}T${time}:00`);
      
      let durationMinutes = 30;
      if (durationStr === '15min') durationMinutes = 15;
      else if (durationStr === '30min') durationMinutes = 30;
      else if (durationStr === '45min') durationMinutes = 45;
      else if (durationStr === '60min') durationMinutes = 60;
      else if (durationStr === '90min(1.5h)') durationMinutes = 90;
      else if (durationStr === '120min(2h)') durationMinutes = 120;
      else if (durationStr === '180min(3h)') durationMinutes = 180;
      else if (durationStr === '240min(4h)') durationMinutes = 240;
      else if (durationStr === '300min(5h)') durationMinutes = 300;
      else if (durationStr === '360min(6h)') durationMinutes = 360;
      else if (durationStr === '420min(7h)') durationMinutes = 420;

      if (existingMeeting?.roomName) {
        await fetch(`/api/meetings/${existingMeeting.roomName}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            description,
            scheduledFor: scheduledFor.toISOString(),
            durationMinutes,
            timezone: tzString,
          }),
        });
      } else {
        await fetch('/api/meetings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomName: generateRoomId(),
            createdByMemberId: user.id,
            title,
            description,
            scheduledFor: scheduledFor.toISOString(),
            durationMinutes,
            timezone: tzString,
            status: 'ACTIVE'
          }),
        });
      }
      onSave(); 
    } catch (error) {
      console.error('Failed to schedule meeting', error);
      alert('Failed to schedule meeting. Try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className={styles.overlay}>
        <div className={styles.modal}>
          {/* Header */}
          <div className={styles.header}>
            <h2 className={styles.title}>{existingMeeting ? 'Edit Meeting' : 'New Meeting'}</h2>
            <div className={styles.headerActions}>
              {existingMeeting && (
                <button 
                  className={styles.btnOutline} 
                  onClick={() => {
                    const url = `${window.location.origin}/rooms/${existingMeeting.roomName}`;
                    navigator.clipboard.writeText(`Join my KloudMeet meeting:\n${existingMeeting.title || 'Untitled Meeting'}\n${url}`);
                    alert('Invite copied to clipboard!');
                  }}
                  type="button"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                  </svg>
                  Copy Invite
                </button>
              )}
              <button className={styles.btnSolid} onClick={handleSave} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              <button className={styles.btnOutline} onClick={onClose} disabled={isSaving}>Close</button>
            </div>
          </div>

          {/* Tabs */}
          <div className={styles.tabContainer}>
            <button 
              className={activeTab === 'general' ? styles.tabActive : styles.tab} 
              onClick={() => setActiveTab('general')}
            >
              General
            </button>
            <button 
              className={activeTab === 'emails' ? styles.tabActive : styles.tab} 
              onClick={() => setActiveTab('emails')}
            >
              Emails
            </button>
            <button 
              className={activeTab === 'ai' ? styles.tabActive : styles.tab} 
              onClick={() => setActiveTab('ai')}
            >
              AI Assistant
            </button>
            <button 
              className={activeTab === 'linked' ? styles.tabActive : styles.tab} 
              onClick={() => setActiveTab('linked')}
            >
              Linked Events
            </button>
          </div>

          {/* Tab Content: General Information */}
          {activeTab === 'general' && (
            <div className={styles.content}>
              {existingMeeting && (
                <div className={styles.formRow}>
                  <label className={styles.label}>Meeting ID</label>
                  <div className={styles.inputWrapper}>
                    <input 
                      type="text" 
                      className={styles.input} 
                      value={existingMeeting.roomName}
                      readOnly
                      style={{ background: '#f8fafc', color: '#64748b', cursor: 'not-allowed', fontFamily: 'monospace' }}
                    />
                  </div>
                </div>
              )}
              <div className={styles.formRow}>
                <label className={styles.label}>Title</label>
                <div className={styles.inputWrapper}>
                  <input 
                    type="text" 
                    className={styles.input} 
                    placeholder="Enter meeting title..." 
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
              </div>

              <div className={styles.formRow}>
                <label className={styles.label}>Description</label>
                <div className={styles.inputWrapper}>
                  <textarea 
                    className={styles.textarea} 
                    placeholder="Please input meeting description..." 
                    rows={4} 
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>

              <div className={styles.formRow}>
                <label className={styles.label}>Set time</label>
                <div className={`${styles.inputWrapper} ${styles.timeRow}`}>
                  <input 
                    type="date" 
                    className={`${styles.input} ${styles.timeInput}`} 
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                  <input 
                    type="time" 
                    className={`${styles.input} ${styles.timeInput}`} 
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                  <select 
                    className={`${styles.input} ${styles.select} ${styles.timeInput}`}
                    value={durationStr}
                    onChange={(e) => setDurationStr(e.target.value)}
                  >
                    <option value="15min">15min</option>
                    <option value="30min">30min</option>
                    <option value="45min">45min</option>
                    <option value="60min">60min</option>
                    <option value="90min(1.5h)">90min(1.5h)</option>
                    <option value="120min(2h)">120min(2h)</option>
                    <option value="180min(3h)">180min(3h)</option>
                    <option value="240min(4h)">240min(4h)</option>
                    <option value="300min(5h)">300min(5h)</option>
                    <option value="360min(6h)">360min(6h)</option>
                    <option value="420min(7h)">420min(7h)</option>
                  </select>
                </div>
              </div>

              <div className={styles.formRow}>
                <label className={styles.label}>Time Zone</label>
                <div className={styles.inputWrapper} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.7rem' }}>
                  <span style={{ color: '#4b5563', fontSize: '0.95rem' }}>{tzString}</span>
                  <button className={styles.linkBtn}>Change</button>
                </div>
              </div>

              <div className={styles.formRow}>
                <label className={styles.label}>Access Option</label>
                <div className={styles.inputWrapper} style={{ display: 'flex', gap: '2.5rem', flexWrap: 'wrap', paddingTop: '0.6rem' }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}>
                    <input type="radio" name="access" value="public" defaultChecked className={styles.radio} />
                    <div>
                      <div style={{ fontWeight: 600, color: '#111827', fontSize: '0.95rem' }}>Public</div>
                      <div style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: '0.2rem' }}>Anybody can freely join.</div>
                    </div>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}>
                    <input type="radio" name="access" value="private" className={styles.radio} />
                    <div>
                      <div style={{ fontWeight: 600, color: '#111827', fontSize: '0.95rem' }}>Private</div>
                      <div style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: '0.2rem' }}>Invited only or require approval to join.</div>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Tab Content: Automated Emails */}
          {activeTab === 'emails' && (
            <div className={styles.content}>
              <div style={{ background: '#eef2ff', color: '#4f46e5', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '0.5rem', fontSize: '0.95rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                </svg>
                Enterprise Edition Only Feature
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                
                {/* Invitation Email */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <input type="checkbox" defaultChecked style={{ width: '18px', height: '18px', accentColor: '#4f46e5' }} />
                  <span style={{ fontSize: '0.95rem', color: '#4b5563' }}>Invitation Email</span>
                  <button className={styles.linkBtn} style={{ color: '#3b82f6', fontWeight: 500, paddingLeft: '2rem' }} onClick={() => setSubModal('invite')}>View</button>
                </div>

                {/* Reminder Email */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <input type="checkbox" defaultChecked style={{ width: '18px', height: '18px', accentColor: '#4f46e5' }} />
                    <span style={{ fontSize: '0.95rem', color: '#4b5563' }}>Reminder Email</span>
                    <button className={styles.linkBtn} style={{ color: '#3b82f6', fontWeight: 500, paddingLeft: '1.9rem' }} onClick={() => setSubModal('reminder')}>View</button>
                  </div>
                  
                  <div style={{ marginLeft: '2.25rem', marginTop: '1rem' }}>
                    <p style={{ fontSize: '0.95rem', color: '#374151', margin: '0 0 1rem 0', fontWeight: 600 }}>Send emails before the event</p>
                    
                    {/* Reminder 1: 1 Days */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <select className={`${styles.input} ${styles.select}`} style={{ width: '80px', padding: '0.5rem' }} defaultValue="1">
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="8">8</option>
                      </select>
                      <select className={`${styles.input} ${styles.select}`} style={{ width: '130px', padding: '0.5rem' }} defaultValue="Days">
                        <option value="Hours">Hours</option>
                        <option value="Days">Days</option>
                      </select>
                      <button style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1.5rem', display: 'flex', alignItems: 'center' }}>×</button>
                    </div>

                    {/* Reminder 2: 8 Hours */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <select className={`${styles.input} ${styles.select}`} style={{ width: '80px', padding: '0.5rem' }} defaultValue="8">
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="8">8</option>
                      </select>
                      <select className={`${styles.input} ${styles.select}`} style={{ width: '130px', padding: '0.5rem' }} defaultValue="Hours">
                        <option value="Hours">Hours</option>
                        <option value="Days">Days</option>
                      </select>
                      <button style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1.5rem', display: 'flex', alignItems: 'center' }}>×</button>
                    </div>

                    <button className={styles.linkBtn} style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                      </svg>
                      Add more reminder email
                    </button>
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* Tab Content: AI Assistant */}
          {activeTab === 'ai' && (
            <div className={styles.content}>
              <div style={{ background: '#eef2ff', color: '#4f46e5', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.95rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                </svg>
                Enterprise Edition Only Feature
              </div>
              
              <div className={styles.formRow}>
                <label className={styles.label}>AI Assistant</label>
                <div className={styles.inputWrapper}>
                  <button className={styles.addBtn}>+ Add</button>
                </div>
              </div>

              <div className={styles.formRow}>
                <label className={styles.label}>Attendee</label>
                <div className={styles.inputWrapper}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    {/* Host User block */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f8fafc', padding: '0.4rem 0.75rem', borderRadius: '24px', border: '1px solid #e2e8f0' }}>
                      <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg viewBox="0 0 24 24" fill="#9ca3af" width="16" height="16">
                          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                        </svg>
                      </div>
                      <div style={{ fontSize: '0.85rem', lineHeight: '1.2' }}>
                        <strong style={{ color: '#111827' }}>Host User</strong>
                      </div>
                    </div>
                    
                    {/* Inline Add Button */}
                    <button 
                      className={styles.addBtn} 
                      style={{ borderRadius: '50%', width: '36px', height: '36px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title="Add Attendee"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              <div className={styles.formRow}>
                <label className={styles.label}>Occurrence</label>
                <div className={styles.inputWrapper}>
                  <select className={`${styles.input} ${styles.select}`} style={{ maxWidth: '300px' }}>
                    <option>One Time</option>
                    <option>Daily</option>
                    <option>Weekly</option>
                  </select>
                </div>
              </div>

            </div>
          )}

          {/* Tab Content: Linked Event */}
          {activeTab === 'linked' && (
            <div className={styles.content} style={{ minHeight: '300px', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
              <div style={{ background: '#eef2ff', color: '#4f46e5', padding: '0.5rem 1rem', borderRadius: '8px', marginBottom: '2rem', fontSize: '0.9rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                </svg>
                Enterprise Edition Only Feature
              </div>
              <div style={{ width: '72px', height: '72px', background: '#f8fafc', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem', border: '1px solid #e2e8f0' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" width="36" height="36">
                  <path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3 style={{ fontSize: '1.25rem', color: '#111827', margin: '0 0 1rem 0' }}>Workflow Integrations</h3>
              <p style={{ color: '#4b5563', fontSize: '1rem', maxWidth: '500px', lineHeight: '1.6' }}>
                This tab will be used to configure linked events with external workflow applications including <strong>ServiceWise</strong>, <strong>CustomerWise</strong>, <strong>ProjectOne</strong>, and <strong>*other software*</strong> integrations.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Sub Modals for Emails */}
      {subModal === 'invite' && (
        <EmailPreviewModal 
          type="Invitation Email" 
          title="Join us for KloudMeeting" 
          body={<>
            Welcome, Please start registration process by entering your name and email.<br/><br/>
            For those who can&apos;t attend our live session, we are providing recording after the event.<br/>
            Once registered, a confirmation email will be sent to you with info on how to join the event.<br/><br/>
            Cheers,<br/>The Kloud team
          </>} 
          onClose={() => setSubModal(null)} 
        />
      )}

      {subModal === 'reminder' && (
        <EmailPreviewModal 
          type="Reminder Email" 
          title="Reminder: KloudMeeting is starting soon" 
          body={<>
            <strong>To join the conference</strong><br/>
            Join from a PC, Mac, or any mobile device.<br/>
            Please click the link to join the conference at the scheduled start time.<br/><br/>
            <strong>To cancel this registration</strong><br/>
            If you can&apos;t attend, you may <span style={{color:'#3b82f6', cursor:'pointer'}}>Cancel</span> your registration at any time.<br/><br/>
            Please contact us with any questions. We&apos;re always happy to help.<br/><br/>
            Cheers,<br/>The Kloud team
          </>} 
          onClose={() => setSubModal(null)} 
        />
      )}
    </>
  );
}

function EmailPreviewModal({ type, title, body, onClose }: any) {
  return (
    <div className={styles.overlay} style={{ zIndex: 110 }}>
      <div className={styles.modal} style={{ maxWidth: '650px', padding: '2.5rem' }}>
        <h2 style={{ margin: '0 0 2rem 0', color: '#1e1e2e', fontSize: '1.5rem', fontWeight: 600 }}>{type}</h2>
        
        <div style={{ marginBottom: '2rem' }}>
          <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '1.05rem', color: '#374151' }}>Email Title</h4>
          <p style={{ margin: 0, color: '#4b5563', fontSize: '1rem', padding: '0.75rem', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>{title}</p>
        </div>

        <div style={{ marginBottom: '3rem' }}>
          <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '1.05rem', color: '#374151' }}>Body</h4>
          <div style={{ color: '#4b5563', fontSize: '1rem', lineHeight: '1.7', padding: '1rem', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
            {body}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
          <button className={styles.btnSolid} style={{ background: '#4f46e5' }}>Reset</button>
          <button className={styles.btnSolid} style={{ background: '#4338ca' }}>Edit</button>
          <button className={styles.btnOutline} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
