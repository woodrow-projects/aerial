# Plan: Auto-DJ, Clockwheels & Scheduling

> **Status: implemented (2026-07-30) — phases A–E shipped.** Built per this plan (ADRs **D17**/**D18**,
> renumbered from the candidates below since D16 went to the CLI). Locked decisions: live show with an
> absent streamer falls through to Auto-DJ (never-silent); media on the local volume; per-install TZ.
> Adversarially reviewed (7 lenses, 3-judge refutation): 6 findings fixed incl. an RBAC-wiring bypass
> now pinned by a reflection spec. Known deltas: per-track `amplifyDb` is stored but not yet applied at
> playout (conflicts with R128 `normalize`; the media UI says so honestly); legacy per-channel stream
> keys remain an advisory fallback pending deprecation. Remaining validation: real-audio end-to-end
> playout against the engine (upload → clock → hear it), per D14's integration layer. Original plan:
>
> ~~**Status: planned.**~~ Concrete scope for Aerial's Auto-DJ — designed to clear AzuraCast parity *and*
> leapfrog it on its biggest gaps (no clockwheel, fuzzy rotation, advisory streamer scheduling). The **admin UI is
> deliberately last**; the data model + API come first so the engine is usable (and scriptable/testable)
> before any UI exists. Builds on: per-channel Liquidsoap (D6), the `/internal/*` hook pattern, operator auth
> (D13).

## Goals

1. A real **Auto-DJ**: upload media, play 24/7 with no live streamer, gapless/crossfaded, correct now-playing.
2. **Clockwheel-first programming** — deterministic, structured hour-clocks (the thing AzuraCast can't do
   without scripting), not just weighted shuffle.
3. **Generalized scheduling** — different programming at different times (dayparting); **scheduled**
   (Auto-DJ-programmed) shows now, **live shows later**, on one model; Auto-DJ fills unscheduled time.
4. **Enforced streamer scheduling by default** — a streamer can only go live during a **live** show assigned
   to them, validated by a per-user streamer key at ingest (solves AzuraCast's "advisory by default" weakness).
5. **Deterministic, inspectable rotation** — always able to answer "why did this track play?"
6. Everything **visually representable** later in an admin UI (built on this API).

## Core model

```
Track          one media file in the install library (path, tags: title/artist/album/duration,
               cue_in/out, fade_in/out, amplify) — assigned to one or more Playlists.
Playlist       a named pool/category of tracks (e.g. "Currents", "Recurrents", "Jingles", "Ads").
               order = shuffle | sequential | random; dedup window; isJingle (hide now-playing).
Clock          a clockwheel: an ordered, repeating template (default period 1h) = the deterministic
               sequence a channel plays when this clock is active. Has ClockSlots.
ClockSlot      one step in a Clock: { position, playlistId, count (N tracks) | maxSeconds, rules }.
               e.g. [Currents×1, Jingle×1, Recurrents×1, Ads×1, Gold×1, ...] repeating.
Show           a programming block on a Channel for a time window (+ recurrence: start/end, days-of-week,
               date range, RRULE later; + priority). Exactly one of two types:
               type = scheduled → Auto-DJ-programmed content: references a Clock (a clockwheel of
                                  Playlists + jingles) — i.e. a time-boxed Auto-DJ program.
               type = live      → outputs ONLY the live stream; references the owning User (the
                                  streamer/admin allowed to broadcast during this window).
User + role    a broadcaster is a User (role: admin | streamer) with a bcrypt-hashed streamer key — see the
               roles note below; replaces a standalone Streamer entity.
Channel        (exists) gains: defaultClockId (the Auto-DJ that fills unscheduled time), enforceSchedule
               (default true).
```

Multi-channel (differentiator): Tracks/Playlists/Clocks live at the **install** level and are reusable across
channels; Shows are per-channel.

> **Update — roles & ownership (supersedes the standalone `Streamer` above).** A broadcaster is **not** a
> separate entity: it is a **User** (better-auth, ADR D13) with a `role`:
> - **`admin`** — full control of the system; may also own shows and stream live (i.e. also act as a streamer).
> - **`streamer`** — no system control; read-only panel access; holds a server-generated, bcrypt-hashed
>   **streamer key** and can go live **only** during a show assigned to them.
>
> **Shows are owned by a User.** A `live` show references the owning User (admin or streamer) allowed to
> broadcast then, and the owner's per-user **streamer key** authenticates the live source. The word "DJ" is
> retired — read **streamer** wherever it appears below; **"Auto-DJ"** is kept *only* as the name of the
> automated-playout feature, never a person. **User & role management** gets an admin SPA screen on the shell
> from [`spa-ui-foundation.md`](./spa-ui-foundation.md).

> **Update — show types & fill (the operator's model).** A Show is exactly one of two types:
> - **`scheduled`** — Auto-DJ-programmed: a defined song rotation + jingle/ad mixing (a Clock over Playlists),
>   i.e. a time-boxed Auto-DJ program.
> - **`live`** — outputs **only** what the owning streamer streams to the channel; no programmed content.
>
> **Auto-DJ fills all unscheduled time:** any window with no Show resolves to the channel's `defaultClock`
> rotation, so the channel is never silent. *Open decision:* what plays during a `live` window whose streamer
> never connects — fall through to Auto-DJ (never-silent; the current rule below) vs an explicit "off-air".

## Playout engine (deterministic, control-plane-owned)

The key architectural choice: **the control plane owns track selection; Liquidsoap just plays what it's told.**
This is the clean version of AzuraCast's non-manual mode — but deterministic and inspectable, and it avoids
the raw-`.liq` footgun.

Per channel, the generated `.liq` becomes:

```
live   = input.harbor(mount, auth=schedule_aware_auth, ...)         # enforced streamer ingest (Phase D)
autodj = request.dynamic(fun () -> request.create(next_track_uri))  # pulls next track from the control plane
radio  = fallback(track_sensitive=false, [live, mksafe(autodj)])    # live takes over; clock is the floor
# crossfade / cue / R128 applied to `radio` in Liquidsoap (per-track cue points from Track metadata)
```

- `request.dynamic` calls the control plane's **`POST /internal/next-track?channel=<slug>`** whenever it
  needs the next track. The control plane:
  1. Resolves the **active Show** for `(channel, now)` (see Scheduling) → the active **Clock** (the show's
     clock, or the channel's `defaultClock` if no show / a live streamer is absent).
  2. Advances that clock's **slot pointer**, picks a track from the slot's playlist (its order + dedup), and
     returns an annotated URI: `annotate:cue_in="2.0",liq_fade_out="3.0",title="...":/srv/media/<file>`.
  3. **Logs the decision** (show → clock → slot → playlist → track) for the "why this track" view.
- Always returns *something* (falls to `defaultClock`, ultimately `mksafe` silence) so the channel never
  drops — Liquidsoap requires an infallible source.
- Library/clock/schedule edits are **DB changes + a queue refresh**, never a full Liquidsoap restart (avoid
  the audio gap that `engine.syncChannel` causes today).

## Clockwheels (the differentiator)

A Clock is a deterministic, repeating sequence of slots. Example "Daytime Music" clock:

```
1. Currents     ×1     5. Ads        ×1 (jingle mode)
2. Jingle       ×1     6. Gold       ×1
3. Recurrents   ×1     7. Currents   ×1
4. Currents     ×1     8. Station ID ×1 (jingle mode)   → repeat
```

The next-track resolver walks slots in order, looping the clock; each slot draws from its playlist with that
playlist's order + a dedup window. This gives **structured, predictable programming** a non-dev can reason
about — vs AzuraCast's probabilistic weight shuffle. Dayparting = **assign different clocks to different Shows**
(e.g. a "Morning Talk" clock 06:00–10:00, "Daytime Music" 10:00–18:00, "Overnight" 18:00–06:00).

## Scheduling & resolution

"What's on now?" for `(channel, now)`, deterministic precedence:

1. A **live Show** now whose owner **is connected** → live source (streamer on air).
2. A **live Show** now whose owner is **absent** → *(open)* fall through to Auto-DJ (`defaultClock`,
   never-silent) or hold an explicit "off-air".
3. A **scheduled Show** now → its Clock (the show's Auto-DJ program).
4. No Show (**unscheduled** time) → the channel's **defaultClock** — Auto-DJ fills the gap.

Recurrence v1 matches AzuraCast (start/end time incl. overnight, days-of-week, date range) and **plans richer
RRULE** (nth-weekday, biweekly, holidays) — an explicit place to beat it. Timezone per-install v1 (note
multi-TZ later). Every resolution is **inspectable** (the schedule view can show "now / next" and why).

## Enforced live-streamer auth (schedule-aware) — Phase D

Replaces "advisory by default" with **enforced by default**:

- Each streaming **User** has a server-generated, **bcrypt-hashed streamer key** (per user, not per channel).
- The harbor `auth` hook (already → `POST /internal/auth`) becomes **schedule-aware**. On a source connection
  it:
  1. Identifies the **user** by the presented streamer key (constant-time compare vs active streamer keys).
  2. Looks up the channel (by mount) and asks the scheduler: *is there a `live` Show active **now** on this
     channel (± a configurable **grace window**, e.g. 5 min) assigned to **this user**?*
  3. **Allow (200)** only if yes; otherwise **deny (401)** → harbor drops the source.
- `Channel.enforceSchedule` (default **true**) gates this. If an operator sets it false, any active streamer
  key works anytime (opt-in advisory mode).
- Graceful fallback (default): during a live Show window with no streamer connected, the channel falls through
  to Auto-DJ (`defaultClock`) so it never goes silent — resolution rule #2 (an explicit "off-air" is the open
  alternative).
- Per-stream logging (`StreamSession` gains `streamerId`) for "who was on air when."

> Candidate ADRs from this (note: **D14** = TDD and **D15** = shadcn are now taken): **D16** control-plane-owned
> deterministic Auto-DJ queue via `request.dynamic`; **D17** schedule-aware, enforced-by-default streamer auth
> + multi-user roles (admin/streamer), shows owned by users. *Not yet Accepted — lock when this work starts.*

## How this beats AzuraCast

| AzuraCast weakness | Aerial approach |
|---|---|
| No native clockwheel (only weights + scripting) | **First-class Clock/ClockSlot** model + deterministic sequencer |
| Fuzzy/opaque rotation precedence | **Deterministic resolution** + "why this track" decision log |
| Streamer scheduling advisory by default | **Enforced by default** via schedule-aware streamer-key auth |
| Best-effort dedup, hardcoded artist split | Deterministic dedup window; configurable artist parsing (fingerprint later) |
| Recurrence only days-of-week + date range | Same v1, **RRULE planned** |
| Raw-`.liq` escape hatch as the only advanced path | All structure is **data-driven**; no station-killing config edits |

## Phased roadmap

- **A — Media + Playlists + control-plane queue.** Upload (multipart) to the media volume + ffprobe tags;
  `Track`/`Playlist` models; swap the watched-dir `playlist()` for `request.dynamic` + `/internal/next-track`
  with deterministic order + dedup. (Real auto-DJ; no UI yet — API/seed-driven.)
- **B — Clockwheels.** `Clock`/`ClockSlot`; resolver sequences slots; per-channel `defaultClock`; decision log.
- **C — Scheduled shows (dayparting).** `Show` (type=scheduled) + recurrence; scheduler resolves the active
  clock per `(channel, now)`; Auto-DJ (`defaultClock`) fills unscheduled gaps. Different programs per daypart.
- **D — Live shows + enforced streamer auth.** User roles (admin/streamer) + per-user streamer keys; `Show`
  (type=live); schedule-aware `/internal/auth`; live takeover with Auto-DJ fallback; `enforceSchedule` toggle.
- **E — Admin UI.** Visual **clockwheel editor** (arrange slots); a **weekly schedule calendar** as the
  primary scheduling view — see what's on at each time, **click a show to manage it inline** (set its window,
  assign a clock or an owning user/streamer); **user & role management** (admin/streamer, streamer keys);
  media library; "now/next + why" — all on the A–D API and the SPA shell from
  [`spa-ui-foundation.md`](./spa-ui-foundation.md).

## Open decisions (for when we start)

- **Crossfade/cue/loudness**: Liquidsoap-side (`crossfade()`, per-track cue points, EBU R128) — confirm the
  exact operators against the pinned Liquidsoap, like the v1 engine validation.
- **Media storage**: local volume now (D11), S3-compatible + local cache later (don't break the non-root,
  no-FUSE hardening).
- **Auto-DJ scope ceiling for the first cut**: a single default clock + a couple of scheduled clocks is the
  smallest thing that demonstrates the differentiator; ordered playlists/requests/skip can follow.
- **Validation**: the resolver/clock/dedup/auth logic is unit-testable headless; full playout validated
  end-to-end against real Liquidsoap (as with v1).
