# AI Taking Notes

By default, AI Notes Only records the room's audio without video. After the audio file is ready,
AssemblyAI transcribes it and SkyMeet uses the recorded speaking intervals to match speakers.
`AI_NOTES_CAPTURE=live` instead opts into the file-free Fun-ASR flow described below.

Full Recording is unchanged, and so are recordings made before this change.

## How live capture works

1. **Start** (`app/api/meetings/[roomName]/record/route.ts`). The recorder (LiveKit web egress
   loading the meeting page as a bot) is started with a stream output that has no destination,
   so it runs but writes and sends nothing. The recording row has `storageProvider = 'NONE'`.
2. **During the meeting** (`lib/useLiveNotesStreamer.ts`, `lib/liveNotesStreamer.ts`). The bot
   page mixes every remote audio track, sends 16 kHz PCM to the existing Fun-ASR relay
   (`scripts/funasr-relay.cjs`), and posts each finished sentence to
   `POST /api/recordings/live-notes`. Sentences become `MeetingTranscript` rows with a
   `live-<recordingId>-…` `sourceId`.
3. **Who said it** (`lib/liveNotesServer.ts`). The bot already reports who is speaking
   (`RecordingSpeakInterval`). Sentences are matched to those intervals as they arrive, and
   once more when the session ends.
4. **Stop**. The server asks the bot to hand in the sentence in progress, stops the recorder,
   and marks the session `READY` with its length taken from the clock. LiveKit's
   `egress_ended` webhook and the dashboard sync do the same if the stop request didn't.
5. **AI presentation** (`lib/meetingPresentationServer.ts`, `lib/meetingPresentation.ts`).
   A few seconds after the session ends the server writes the AI summary (if the meeting has
   none) and one more model call "directs" the presentation: a takeaway headline and a spoken
   line per topic, a quote, what was decided, what to skip. Everything is checked against the
   transcript. The result is stored in `MeetingPresentation`.
6. **Replay** (`app/recordings/[id]/page.tsx`, `lib/NotesReplayStage.tsx`). There is no media
   file, so the player keeps time with a silent audio file of the session's length
   (`GET /api/recordings/silence`). The stage shows either the AI presentation or the full
   timeline in the LiveDoc stage. The transcript is available in the side panel.

## Deploying

- Run `prisma/add_meeting_presentation.sql` on the database. Until it is run, replay still
  works and simply has no AI presentation.
- The Fun-ASR relay must be restarted with the app: it now passes on each sentence's times and
  waits for the last sentence when a stream is finished.
- Configure and enable AssemblyAI for the default file transcription. `DASHSCOPE_API_KEY` is
  required for live capture. `DEEPSEEK_API_KEY` or `OPENAI_API_KEY`
  is required for the summary and presentation (as for AI summaries today).

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `AI_NOTES_CAPTURE` | `file` | `live` transcribes during the meeting without keeping an audio file |
| `AI_NOTES_LANGUAGE` | empty | A language hint for the recognizer (`zh`, `en`, `ja`, `ko`). Empty lets it detect the language; it accepts only one hint |
| `DASHSCOPE_WS_URL` | DashScope's public address | The recognizer's WebSocket address, if a workspace address should be used |

## Safety nets

- If the recorder refuses to start without a file, that session records an audio file as before.
- If a live notes session of a meeting failed before producing any notes, the next start within
  30 minutes records a file.
- While live notes run, live captions of the same meeting are still shown but not stored, so
  the transcript has each sentence once.
- A notes session is billed by its length like a recording; its lines are not also counted as
  caption minutes.

## Not yet verified against the real services

These were tested with stand-ins (a scripted recognizer, a scripted LiveKit client) and with a
real browser, but not in a real meeting:

- That LiveKit Cloud keeps a web egress running with a stream output that has no destination.
- Recognition quality on real speech, especially mixed Chinese and English, compared with the
  file transcription it replaces.
- That the recognizer's sentence times are measured from the start of the audio stream (the
  code falls back to arrival time when they can't be).
- How long one recognition stream may stay open (the page reconnects when it closes).
- The wording of the presentation: the prompt has not been run against DeepSeek or OpenAI here.
