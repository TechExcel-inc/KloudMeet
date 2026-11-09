# SiMeet as a Kloud subsystem

SiMeet runs as a subsystem of Kloud: every person who signs in to SiMeet is automatically a member
of the **SiMeet SubSystem** in Kloud, with no setup and no user input. Kloud holds identity and
documents; SiMeet keeps its own records (members, teams, meetings, billing) for SiMeet features.

This repository is public: server addresses, the Kloud company IDs, the subsystem token and the
Kloud-side build and deploy steps are kept out of it (they are in the team's private Kloud server
repository).

## How it works

| Piece | Where | What |
| --- | --- | --- |
| Kloud subsystem | Kloud | A Kloud company under the parent Kloud company, of the Kloud Meet integration type, with its own secret token. The parent company's owners and admins are its owners and admins. |
| `SubSystemExchangeToken` | Kloud PeerTime API, `/peertime/V1/P1Integration/SubSystemExchangeToken` | Server-to-server only (header `SubSystemToken`). Finds the Kloud user by email, else by `UniqueID`, creates one if needed, adds them to the subsystem as a plain member (existing contacts keep their role) and returns `{ UserID, UserToken, ExpiresIn, Role }`. |
| Join at sign-in | `lib/kloudSubsystem.server.ts`, called from the six sign-in routes in `app/api/auth/` | In the background, so a Kloud outage never blocks a sign-in. Sends only verified email and phone, with `UniqueID = simeet:<member id>`. Saves `TeamMember.kloudUserId` the first time (never replaces a different existing link). Caches each member's Kloud token and renews it an hour before it expires. |
| LiveDoc stage login | `lib/livedoc/stageIdentity.server.ts`, `app/api/livedoc/stage-identity` | Signed-in members use their subsystem login; From Space (`kloudLogin`) only for the subsystem's owners and admins. If Kloud can't be reached: the anonymous instant account. Guests are unchanged. |
| Meetings in the subsystem | `lib/peerTimeCompany.ts` (used by `create-meeting-instance` and `keepalive`) | When the stage token is the signed-in member's subsystem Kloud user (compared by Kloud user ID), the LiveDoc meeting is created in the subsystem. |
| From Space | Kloud-Web `src/components/googlemeet/MainStage.vue` (`resolveSpaceCompany`) | In SiMeet (`fromjitsi`), when the meeting's company is a subsystem, From Space browses the parent company's spaces (Kloud's `subsystem/parent_company`). |
| Status | `app/api/account/kloud-subsystem`, Account Settings → Kloud Integration | "You are a member / an admin" instead of the Connect and Link steps. |
| Backfill | `POST /api/account/kloud-subsystem/backfill` (SiMeet staff) | Joins every active member now instead of at their next sign-in. |

Tests: `lib/__tests__/kloudSubsystem.test.ts`, `lib/livedoc/stageIdentity.server.test.ts`.

## Switch

Off unless both are set in the server's `.env.local`:

```
SIMEET_KLOUD_SUBSYSTEM_ID=<the subsystem's Kloud company ID>
SIMEET_KLOUD_SUBSYSTEM_TOKEN=<its token; never commit it>
```

Remove both and redeploy to go back to the old behaviour (the browser's kloud.cn login, meetings in
the person's own Kloud company).

## Known gaps and next steps

- People join the subsystem only through a SiMeet sign-in or the backfill.
- SiMeet teams (`KloudMeetAccount`) are not Kloud companies or teams yet; documents are per
  meeting, and only Kloud admins browse the subsystem's content.
- The per-team "link a Kloud company" flow (`app/api/account/kloud-company`) still serves the case
  where the subsystem is off; retire it once the subsystem is permanent.
- Meetings created before the switch stay in the company they were created in.
