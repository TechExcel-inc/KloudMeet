# Calendar sync — design notes

Status: **Phase 1 shipped on `feat/calendar-sync`. Phase 2 is a proposal, not implemented.**

## 1. What Phase 1 does (no third-party accounts)

| Piece | Where | Direction |
| --- | --- | --- |
| `.ics` per meeting | `GET /api/meetings/:roomName/calendar.ics` | Kloud → any calendar (manual import) |
| Google / Outlook.com / Office 365 links | `lib/calendar/links.ts` | Kloud → the user's own calendar (prefilled "new event" form) |
| Private subscription feed | `GET /api/calendar/feed/<token>.ics` | Kloud → Apple / Google / Outlook, re-polled by the calendar app |

Phase 1 limitations, and the reasons to consider Phase 2:

- **Attendees are not invited by Kloud.** The host has to send the invite text or the `.ics` themselves.
- **Edits don't reach copies people have already added.** Google and Outlook template links create an independent event. A re-imported `.ics` replaces the earlier copy in most apps, because the UID is stable and SEQUENCE is derived from `modifiedAt`. The feed updates on its own, but slowly: Google re-polls subscribed calendars every few hours (often 8–24 h), and Apple and Outlook usually poll hourly.
- **Changes made in the calendar don't come back to Kloud.** Moving the event in Google does not move the Kloud meeting.
- **The feed lists only meetings the member hosts**, because Kloud has no attendee model yet.

## 2. Goal of Phase 2: two-way sync

1. When a member connects Google or Microsoft and schedules a meeting, Kloud creates the event **on the organizer's own calendar**, including the attendees. Google or Exchange then sends the invitations, from the organizer's address.
2. When the meeting is edited or canceled in Kloud, the event is patched or canceled, and the provider sends the update or cancellation mails.
3. When the organizer moves or cancels the event in their calendar, Kloud updates the meeting. Attendee RSVPs are shown in Kloud.

## 3. Google Calendar

### 3.1 OAuth

- Kloud already has Google sign-in (`app/api/auth/google`). Add a separate **"Connect Google Calendar"** flow that uses incremental authorization: `include_granted_scopes=true`, `access_type=offline`, and `prompt=consent` so Google returns a refresh token.
- Scope: `https://www.googleapis.com/auth/calendar.events`, which allows reading and writing events on the user's calendars.
  - It is a **sensitive** scope, not a *restricted* one. That means Google OAuth verification is required, but the CASA third-party security assessment is not (that assessment is for Gmail and Drive restricted scopes).
  - Before submitting, check whether Google's newer, narrower scopes would be enough (for example `calendar.events.owned`, or `calendar.app.created` for app-created calendars). A narrower scope makes the consent screen and the review easier. The scope list changes over time, so confirm against the current Google docs.
- Without verification, the app is capped at **100 test users** and shows an "unverified app" warning.

### 3.2 Creating and updating events

- `events.insert` on `primary` with:
  - `summary`, `description` (join link and meeting ID), and `location` (the join URL)
  - `start` and `end` as UTC `dateTime`, plus `timeZone` = `Meeting.timezone`
  - `attendees[]` (email, display name)
  - `reminders`
  - `source: { title: 'Kloud Meet', url: joinUrl }`
  - `iCalUID: meeting-<roomName>@kloudmeet`. This is the same UID as the Phase 1 `.ics`, so someone who imported the `.ics` and then gets the Google invite does not end up with a duplicate in Google.
  - `extendedProperties.private.kloudRoom = roomName` and `kloudVersion = <modifiedAt>`, used to suppress echoes (see §3.4).
- Use `sendUpdates=all` on insert, patch and delete so that Google emails the attendees.
- Don't use `conferenceData` for the Kloud link. A third-party conference provider needs a Google Workspace Add-on (conference solution), which is a separate Marketplace listing and review. Location plus description is enough to start with.
- Cancel with `events.delete` and `sendUpdates=all`. Google then sends cancellations, and the event shows as cancelled for attendees.

### 3.3 Inbound changes (watch channels)

- `events.watch` on the organizer's `primary` calendar points at `POST /api/webhooks/google-calendar` (HTTPS with a valid certificate).
- The webhook payload carries only headers (`X-Goog-Channel-ID`, `X-Goog-Resource-State`). On each notification, run `events.list?syncToken=…` to fetch the changes. On `410 Gone`, run a full resync and store the new `nextSyncToken`.
- Channels expire (about a week at most). Renew them from the existing cron area (`app/api/cron`) about a day before `expiration`, and stop old channels with `channels.stop`.
- Only act on events that carry `extendedProperties.private.kloudRoom`. Events the user created directly in Google are ignored.

### 3.4 Conflict rules (proposal)

- **Kloud is the source of truth** for title, description and join link. Changes to those made in Google are overwritten on the next Kloud edit.
- **Time and cancellation are two-way.** A newer Google `updated` value moves `Meeting.scheduledFor` and `durationMinutes`. Cancelling in Google sets `status = CANCELED`.
- **Echo suppression:** when Kloud writes an event, store the returned `etag` and `kloudVersion`. An inbound change whose `etag` matches what Kloud last wrote is ignored.
- **Last writer wins:** compare Google `updated` with `Meeting.modifiedAt`. Changes made within the same few seconds go to Kloud.
- **RSVPs:** `attendees[].responseStatus` is copied into a new `MeetingAttendee` table, display only.

### 3.5 Storage (new tables)

```text
CalendarConnection  id, memberId, provider ('google'|'microsoft'), accountEmail,
                    refreshTokenEnc (AES-256-GCM, key from env/KMS), accessToken?, accessTokenExpiresAt?,
                    scopes, syncToken?, channelId?, channelResourceId?, channelExpiresAt?,
                    status ('active'|'revoked'|'error'), createdAt, modifiedAt
CalendarEventLink   id, meetingId, connectionId, externalEventId, etag, lastSyncedAt
MeetingAttendee     id, meetingId, email, displayName?, responseStatus?, source
```

- Refresh tokens are encrypted at rest and never returned by any API (unlike `calendarFeedToken`, which is shown to its owner on purpose).
- An `invalid_grant` response (the user revoked access, or a password-related revocation) sets the connection to `revoked`, and the UI shows "Reconnect".
- **Disconnect** does three things: POST to `https://oauth2.googleapis.com/revoke`, `channels.stop`, and delete the stored tokens.

### 3.6 Google Cloud setup checklist

1. Create a Google Cloud project, or reuse the one behind Google sign-in, and enable the **Google Calendar API**.
2. Configure the OAuth consent screen:
   - User type External, publishing status In production.
   - App name, logo and support email.
   - **Authorized domains:** the production domain, verified in Google Search Console.
   - Links to the homepage, the **privacy policy** and the **terms**. The privacy policy must say what calendar data is read and stored, and must state compliance with the Google API Services User Data Policy, including its Limited Use requirements.
3. Add the calendar scope and submit for verification. Google asks for a scope justification and a **YouTube demo video** of the OAuth flow and the in-app feature. Plan for roughly 1–4 weeks, with back-and-forth.
4. Register the redirect URIs for the connect flow in the OAuth client.
5. Webhook endpoint: public HTTPS. Confirm Google's current requirements for push-notification domains when implementing.
6. Quotas: the defaults (per project per day, and per user per minute) are generous for this use. Add exponential backoff on `403 rateLimitExceeded` and `429`.
7. **Network:** the server that calls `googleapis.com` must be able to reach it. Deployments in mainland China (for example Aliyun CN) cannot, and would need an overseas worker or proxy for calendar calls.

## 4. Microsoft 365 / Outlook (Microsoft Graph)

| Concern | Microsoft equivalent |
| --- | --- |
| App registration | Microsoft Entra ID app registration, "Accounts in any organizational directory and personal Microsoft accounts" (multi-tenant + MSA) |
| Scopes (delegated) | `Calendars.ReadWrite`, `offline_access`, `User.Read` (+ `openid email profile`). User consent is enough unless a tenant admin has restricted it |
| Trust / review | **Publisher verification** (Microsoft AI Cloud Partner Program ID) gets rid of the "unverified" consent warning. Many tenants block unverified multi-tenant apps. No app-store-style review is needed for Graph calendar scopes |
| Create with invites | `POST /me/events` with `attendees[]`; Exchange sends the invitations from the organizer. Use `transactionId` for idempotent retries and `singleValueExtendedProperties` (or an open extension) to store `kloudRoom` |
| Update / cancel | `PATCH /me/events/{id}` sends updates to attendees; `POST /me/events/{id}/cancel` with a comment sends cancellations |
| Inbound changes | `POST /subscriptions` on `me/events` with change types `created,updated,deleted`. Max lifetime is about 3 days for Outlook events, so renew from cron. The webhook must answer the `validationToken` handshake within 10 s. Use `clientState` to authenticate notifications and handle lifecycle notifications (`reauthorizationRequired`, `missed`) |
| Incremental fetch | `GET /me/calendarView/delta` with a stored `deltaLink` (Graph's equivalent of Google's syncToken) |
| Tokens | Refresh tokens rotate. Store the newest one from every refresh; they expire after about 90 days without use. `invalid_grant` → reconnect |
| Online-meeting field | Leave `isOnlineMeeting` false. Teams would generate its own link. Put the Kloud link in `location` and `body` |

Setup checklist: Entra app registration, redirect URIs, a client secret or (preferably) a certificate, API permissions as above, publisher verification, privacy and terms URLs on the app registration, and a public HTTPS webhook URL.

## 5. Suggested phasing and effort

| Step | Scope | Rough effort |
| --- | --- | --- |
| 2a | Attendee model + "Connect Google" + **one-way push** (insert, patch, delete with `sendUpdates=all`), no watch channels | 1–1.5 wk dev + Google verification lead time |
| 2b | Google watch channels + syncToken + conflict rules + RSVP display | ~1 wk |
| 2c | Microsoft Graph (same shape as 2a + 2b) | ~1.5 wk + publisher verification |
| ops | Token encryption key management, channel/subscription renewal cron, monitoring of `revoked` connections | ongoing |

## 6. Decisions for the owner

1. **Do we need inbound sync (2b), or is push-only (2a) enough?** Push-only covers "attendees get a real invite and updates". Inbound is mainly needed if hosts reschedule from their calendar.
2. **Who receives invites:** only the attendees the host types into Kloud, or also people who join through the link (requires capturing emails at join)?
3. **Google first or Microsoft first?** Overseas B2B leans Microsoft 365, while SMB and prosumer users lean Google. Each needs its own verification track, and they can run in parallel.
4. **Hosting:** confirm that the production API can reach `googleapis.com` and `graph.microsoft.com`, or budget for an overseas relay.
5. **Privacy policy update**, needed before submitting either verification.
