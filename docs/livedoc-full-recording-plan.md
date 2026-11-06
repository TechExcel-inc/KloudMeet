# LiveDoc Full Recording for SiMeet — design

Status: v7, ready to implement (2026-10-26). Adds seek ("most recent page" rebuild, reusing Kloud's player) and
playback speed to v5 (screen-share recording and the findings from two real recordings).

## Goal

When the host picks **LiveDoc Full Recording**, a SiMeet meeting records like a Kloud LiveDoc meeting:
every LiveDoc operation (document switch, page turn, zoom and scroll, mouse pointer, clicks, every
annotation), the meeting's voice, and screen-share segments. Replay shows the LiveDoc view with the voice,
switches to the shared screen in full view while a screen share was on, and shows webcams in a SmartCam
popup.

## Foundations (product owner)

- Kloud's own meetings already save and replay every LiveDoc operation, accurately and at high
  resolution (page images or PDF per page). The server side is proven.
- LiveDoc already syncs in real time to every user inside SiMeet. Replay feeds recorded operations into the
  same plugin code path.
- Small and precise: no port of Kloud's Vue meeting files; media capture is not tied to LiveKit.
- Screen share takes the whole view in replay; webcams as a SmartCam popup.
- Media is stored with SiMeet's existing recording pipeline. Google Meet does not need LiveDoc playback.

## Evidence from two recordings (2026-10-26)

| Saved actions | Kloud meeting 2425570, rec 93774 | SiMeet meeting kuf-grmp-jhi, rec 93773 |
|---|---|---|
| Total, in time order | 398 | 70 |
| Document switch (actionType 8) | 7, two documents | **0** |
| Document id on each action | 1772434 / 1772435 | **0 everywhere** |
| Page turns (type 2) | 34 | 33 |
| Mouse pointer (type 34) | 208 | **0** |
| Zoom/scroll (type 32) | 8 | **0** |
| Clicks / select (35 / 104) | 22 / 6 | 14 / 0 |
| Annotations | 66 line/ellipse (24) | 16 brush (25), 3 rect (23) |
| Speaking (213) | 43 | **0** |
| Voice section start (200) | 1 | 0 |

Kloud started and stopped recording 93773 from SiMeet's own Kloud account and saved every operation the
plugin sent. Kloud's player loaded it but showed no document, because no document switch was recorded (the
server's current document stayed 0). Kloud's meeting sends that message when recording starts and on every
switch; the plugin does not. Both recordings are kept as test fixtures.

## Architecture

```
 LIVE MEETING (SiMeet room page)
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ RecordingController (client)                                            │
 │   ├─ LiveDoc plugin iframe ──postMessage──▶ Kloud-RecordingStarted/Stopped│
 │   │      plugin sends record-only actionType 8 (document), 9 (mode),     │
 │   │      213 (speaking) over its Kloud websocket → Kloud saves them      │
 │   └─ LiveKit room events: screen share on/off, active speakers           │
 └──────────────┬──────────────────────────────────────────────────────────┘
                │ /api/meetings/[room]/record
 SiMeet server  ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ RecordingSession                                                        │
 │   Kloud: start_recording / end_recording (service account)             │
 │   MediaCapture (interface) ── LiveKitCapture                            │
 │        voice: audio-only room egress, whole recording                   │
 │        screen: track egress per screen-share track while published      │
 │   egress webhook → RecordingSection rows (kind, file, startMs, endMs)   │
 └─────────────────────────────────────────────────────────────────────────┘

 REPLAY (/recordings/[id])
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ ReplayClock ← voice <audio> (master clock)                              │
 │ Stage: mode 3 and a screen section covers t → <video> full view         │
 │        otherwise → LiveDoc plugin iframe (replay mode, driven by time)  │
 │ SmartCam popup · CC · transcript · chapters                             │
 └─────────────────────────────────────────────────────────────────────────┘
```

## Recording

### Start (host presses Record; meeting option = LiveDoc Full Recording)

1. SiMeet server calls Kloud `POST recording/start_recording?meetingId=<Meeting.kloudMeetingId>` with
   SiMeet's Kloud service account → `livedocRecordingId`; stores `livedocStartedAt`.
2. Starts voice capture (`MediaCapture.startVoice`). If a screen share is already on, starts screen capture
   for it.
3. Broadcasts the recording state as today; the host's page posts `Kloud-RecordingStarted` to the plugin.
4. The plugin (Kloud-Web `googlemeet/MainStage.vue`) sends record-only messages (`noForwarding=1`):
   - actionType 8 for the current document and page (same payload as live `sendSwitchFileMsg`), so the
     server's current document is set and every following action carries it;
   - actionType 9 with the current view mode: 0 document, or 3 screen share with the sharer's user id.

### During the meeting

- Document switch while recording → the plugin re-sends actionType 8 (Kloud's `LiveLesson.js:21346`).
- Screen share starts (LiveKit `TrackPublished`, source screen) →
  - SiMeet server starts a track egress for that track (`MediaCapture.startScreen`);
  - the host's page tells the plugin `Kloud-ViewMode {mode:3, userId}` → record-only actionType 9.
- Screen share stops → stop that egress; `Kloud-ViewMode {mode:0}` → actionType 9 mode 0.
- Speaking: SiMeet already knows active speakers from LiveKit; the host's page forwards
  `Kloud-Speaking {userId, stat, duration}` → record-only actionType 213 (Kloud's `NoticeUserSpeaking`).
- Mouse and zoom: check why the plugin sent no type 34/32 in rec 93773 (pointer moves are only sent while
  `whiteboard._isRecord` is on, which the plugin sets by role); fix in the plugin if it is switched off.

### Stop

Stop button or LiveKit `room_finished` → stop all captures → Kloud `end_recording`.

### Media sections

Each egress file becomes a `RecordingSection` row when its webhook reports it complete:

| Field | Meaning |
|---|---|
| `recordingId` | SiMeet `Recording` |
| `kind` | `voice` · `screen` · (later) `camera` |
| `storageKey` | file in SiMeet's bucket (S3 or Aliyun OSS, existing config) |
| `startMs`, `endMs` | on the LiveDoc timeline: egress start − `livedocStartedAt` |
| `userId` | sharer / speaker, when known |
| `providerRef` | egress id (provider-specific) |

Optional later: also register sections with Kloud (`local_recording/upload_recording_file_data`) so
Kloud's own player plays them.

### `MediaCapture` interface (provider-neutral)

```ts
interface MediaCapture {
  startVoice(ctx: CaptureContext): Promise<string>;                       // providerRef
  startScreen(ctx: CaptureContext, track: { id: string; userId?: string }): Promise<string>;
  stop(providerRef: string): Promise<void>;
}
type CaptureContext = { roomName: string; recordingId: number; storagePrefix: string };
// The provider's webhook calls RecordingSession.sectionReady({providerRef, storageKey, startedAt, endedAt}).
```

`LiveKitCapture` implements it with LiveKit egress (audio-only room composite for voice, track egress for
screen share). Another media server only needs its own implementation.

## Replay

1. `/recordings/[id]` loads the SiMeet recording, its sections (presigned URLs), the transcript, and
   `livedocRecordingId`.
2. **Clock:** the voice `<audio>` is the master; with no voice, a wall clock. Speed control applies to both.
3. **Mode timeline:** from Kloud's actions (actionType 9) and SiMeet's screen sections. At time t:
   screen share if mode is 3 and a screen section covers t; otherwise LiveDoc.
4. **LiveDoc view:** the plugin iframe in replay mode. SiMeet posts `Kloud-ReplayTime {ms, playing, rate}`;
   the plugin's `ReplayController` fetches Kloud's actions in windows and applies everything up to `ms`
   through the live-sync handlers (`onPlayBaseAction` for frames, the live message handlers for
   actionType 8/9/33). A seek uses the "most recent page" rebuild below. Handles "no document yet"
   (rec 93774 starts with none).
5. **Screen-share view:** `<video>` full view at `t − startMs`, kept in sync with the clock (re-seek if
   off by > 300 ms).
6. **SmartCam popup:** speaker avatars from Kloud's user actions (202) and speaking (213) first; camera
   video later.
7. **CC and transcript** follow the clock; chapters and transcript lines seek.
8. **Access:** public meetings with a per-browser playback instant account; private/protected check the
   viewer in SiMeet first.

### Normal playback

As the clock advances, every LiveDoc action is applied in time order the moment the clock passes its
time: document switch, page turn, zoom/scroll, pointer, clicks, annotations. The viewer sees the meeting
exactly as it happened.

### Seek: rebuild the "most recent page", then continue

Kloud's own meeting player already seeks this way, so the plugin reuses it rather than writing a new one.
`LessonPlayer.vue` `onPlayTimeChanged` calls `recording/atomic_info(recordingId, t)`, which gives the
document and page at t, then `playLessonByAtomicInfo`. After that, `LiveLesson.js` `onPlayLessonTo(t)` shows
the page, clears it, replays the page's saved objects from `page_object` and then that page's actions up to
t from `Soundtrack/RecordLessonPageActions(id, t)`. The server finds the current document and page itself
(`SoundtrackActionHelper.cs`).

When the user jumps to time t (seek bar, chapter, transcript line, CC):

1. **Find the most recent page.** Look back from t for the latest document switch (actionType 8) and the
   latest page turn (2). The later of the two gives the current document and page at t. Also take the
   latest view mode (9) ≤ t, so the stage shows the screen video instead if a share was on at t.
   No document switch before t → show the "no document yet" state.
2. **Show that page** of that document (page image / PDF from `page_object/list`).
3. **Collect every LiveDoc operation for that page up to t**, across all earlier visits to the page, since
   annotations stay on a page after the presenter leaves and comes back. Kloud's
   `Soundtrack/RecordLessonPageActions(t)` returns this list; otherwise filter the action windows by
   document id + page number.
4. **Fast-forward play them**: apply them in time order instantly — no stroke animation, no pointer
   movement, no redraw between steps. Erases and clears are in the list, so the result matches the page at
   t. Transient actions only keep their final state: the last zoom/scroll after the latest arrival on the
   page, and the last pointer position (if within a few seconds of t; otherwise hidden).
5. **Continue normal playback** from t with the clock.

Shortcuts:

- Forward seek on the same page (no document switch or page turn between the current time and t):
  fast-forward only the actions between the two times; no rebuild.
- Backward seek, or any seek that changes the page: full rebuild (steps 1–5).
- While the user drags the seek bar, rebuild only on release (or debounced every ~250 ms), so scrubbing
  stays smooth.

### Playback speed (1×, 1.5×, 2×, 3×)

Speed only touches two things; seek and the rebuild above stay the same:

- **Voice:** `<audio>.playbackRate = rate` with `preservesPitch` on, so speech stays clear at 2× and 3×.
  The screen-share `<video>` gets the same rate.
- **LiveDoc actions:** they follow the clock, which reads the audio's current time, so they speed up or
  slow down with it automatically. Actions that animate over time (a brush stroke drawn point by point,
  pointer moves) scale their animation durations by 1/rate. `Kloud-ReplayTime` carries `rate` for this.
  At 3×, pointer-move frames can be thinned (keep every n-th) to save redraws.

## Screen Share Recording must keep working well

The pre-join option **Screen share recording** is SiMeet's existing, working recording (LiveKit egress
of the room to one video, played on the replay page). This project must not weaken it:

- Its path stays as is: the same record route branch, egress settings, webhook, storage, streaming and
  replay page code. New code runs only when the meeting's option is `livedoc_full` (or later `ai_smart`).
- Shared pieces (record route, webhook, replay page) are changed by adding branches, not by rewriting the
  existing path; `Recording.kind` defaults to `screen_share` so existing recordings play exactly as before.
- Regression tests before each deploy: start/stop, pause/resume, a 3-minute recording with a screen
  share, the webhook marking it ready, transcription, and replay (seek, speed, CC) — on desktop and phone.
- Inside LiveDoc Full Recording, screen-share segments are recorded by their own track egress and shown
  full view in replay (above), so a meeting that mixes LiveDoc and screen share replays both well.

## Data model (SiMeet, Prisma)

- `Meeting.recordingOption` (`none` · `ai_smart` · `livedoc_full` · `screen_share`), set from pre-join.
- `Recording.kind`, `Recording.livedocRecordingId Int?`, `Recording.livedocStartedAt DateTime?`.
- New `RecordingSection` (fields above).

## Messages

| Message | Direction | Fields | When |
|---|---|---|---|
| `Kloud-RecordingStarted` | SiMeet → plugin | `recordingId` | recording starts (host page) |
| `Kloud-RecordingStopped` | SiMeet → plugin | — | recording stops |
| `Kloud-ViewMode` | SiMeet → plugin | `mode`, `userId` | screen share on/off while recording |
| `Kloud-Speaking` | SiMeet → plugin | `userId`, `stat`, `duration` | speaker changes while recording |
| `Kloud-RecordingState` | plugin → SiMeet | `recording`, `recordingId` | join, heartbeat, MEETING_CHANGE 16 |
| `Kloud-ReplayLoad` | SiMeet → plugin | `recordingId`, `token` | replay page opens |
| `Kloud-ReplayTime` | SiMeet → plugin | `ms`, `playing`, `rate` | several times a second, and on play/pause |
| `Kloud-ReplaySeek` | SiMeet → plugin | `ms` | user seeks |
| `Kloud-ReplayReady` / `Kloud-ReplayMode` / `Kloud-ReplayPage` | plugin → SiMeet | `durationMs` / `mode, userId` / `itemId, pageNumber` | replay state |

All use the LiveDoc AI bridge's origin checks.

## Work plan

| Step | Where | What | Size |
|---|---|---|---|
| 1 | Kloud-Web plugin | Recording messages in/out; record-only 8 at start and on switch; 9 for view mode; 213 speaking; recording state; check mouse/zoom recording | Small |
| 2 | SiMeet | `recordingOption` plumbing; Prisma fields and `RecordingSection`; `livedoc_full` branch in the record route; Kloud start/end; `room_finished` stop | Small–medium |
| 3 | SiMeet | `MediaCapture` + `LiveKitCapture` (voice room egress, screen track egress on publish/unpublish); webhook → sections; host page forwards view mode and speaking to the plugin | Medium |
| 4 | Kloud-Web plugin | Replay mode: `ReplayController` (windows, apply up to time, most-recent-page seek rebuild, speed-scaled animations, no-document start), replay entry that skips the live websocket, replay messages; fix the undeclared `playLessonInfoEx` | Medium |
| 5 | SiMeet | Replay page: clock, mode timeline, stage switch (LiveDoc / screen video), SmartCam avatars, CC and chapters wiring | Medium |
| 6 | Both | Later: camera video in SmartCam, pause (end/start media sections; actions continue), optionally register sections with Kloud | Later |

Rough size: plugin ~700–1,000 lines; SiMeet ~1,000–1,400 lines.

## Acceptance tests

1. **Fixture replay:** recordings 93774 (Kloud) and 93773 (SiMeet, after step 1 a new one) replay with the
   correct document, pages, annotations, pointer and zoom at sampled times (state compared at t = 0, 15 s,
   45 s, end).
2. **End-to-end in SiMeet:** a 3-minute meeting: open document, switch document, turn pages, zoom,
   annotate, move the pointer, start and stop a screen share, speak. Replay: LiveDoc view with voice;
   full-view screen share for exactly the shared stretch; back to LiveDoc; seek into the middle of each.
3. **Late joiner and host leave:** recording continues and replays correctly.
4. **Provider seam:** `LiveKitCapture` can be swapped for a fake capture in tests.

## Implementation order

Steps 1 and 2 are independent and start first. Step 3 needs step 2. Step 4 needs step 1's new recordings.
Step 5 needs steps 3 and 4. Each step ships behind `recordingOption = livedoc_full`, so Screen share
recording is untouched throughout. Before each SiMeet deploy, run the regression tests above.

## Implementation notes (steps 1–2, 2026-10-26)

- **Kloud start/end:** `start_recording` and `end_recording` use the Kloud token (instant account) of the
  person who presses Record, sent by their page. The token is kept on the `Recording` row only until
  Kloud's recording is ended (stop, egress end or `room_finished`, whichever comes first), then cleared.
  No separate service account is needed.
- **Voice until step 3:** `livedoc_full` records the voice with the existing audio-only web egress, so
  the webhook, storage and READY flow are the proven ones. Step 3 replaces it with `MediaCapture`.
- **Plugin:** `MEETING_CHANGE 16` (Kloud's own "recording started") also marks the plugin as recording.
  The starter's page announces, and its plugin sends record-only 9 and 8. Each page reports its own
  speaking and its own screen share (step 3 wires those senders).
- **Mouse/zoom (open item 2):** the cause is `canSendDocMsg`: 32/34 were sent only for role 2 (presenter),
  and SiMeet's host is role 5. While recording, the host now sends them too.
- **LiveDoc must be open once:** start needs `Meeting.kloudMeetingId`, which is set when LiveDoc first
  binds; otherwise start returns `LIVEDOC_NOT_READY`.

## Open items (resolve inside the step named)

1. Step 4: confirm `Soundtrack/RecordLessonPageActions` and `page_object` accept a meeting recording's id
   (Kloud's meeting playback calls them with `thinkCurrentID`); try it on rec 93774 first.
2. Step 1: mouse/zoom missing in rec 93773. The plugin turns on pointer recording only for some roles
   (`MainStage.vue` `whiteboard.SetRecord(showUploadFile || role == 2 || role == 5)`), so check the
   recording host's role and turn it on for whoever is presenting while recording.
3. Step 4: replay URL. Proposal: a `?replay=<recordingId>` flag on `/GoogleMeet/MainStage`, so replay
   shares MainStage's handlers.
4. Step 3: check that screen-share audio (if a share has sound) is captured in its track egress.
5. Check recording 93774's voice section once Kloud finishes converting it.
