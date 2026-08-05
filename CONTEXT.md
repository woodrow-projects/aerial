# Aerial — Ubiquitous Language

Glossary of canonical terms. Code, docs, and UI use these words with exactly these meanings.
Decisions and implementation details live in `docs/ADRS.md` and `docs/plans/` — not here.

## Station

One Aerial deployment: one domain → one VM (or one local machine) → one Aerial install.
The unit the `aerial` CLI manages — provisioned, listed, and destroyed as a whole.
A station contains one or more [Channels](#channel); the CLI never operates below station level.

## Channel

One stream within a [Station](#station) (its own Liquidsoap pipeline, HLS rendition set,
Icecast mount, and `nowplaying.json`). Managed by the station's control panel, never by the CLI.

## Operator

A human with an account on a station's control panel. Roles: `admin` | `streamer`.

## Streamer

An operator role: someone who broadcasts live into a channel via source software
(BUTT/Mixxx) using a per-channel stream key. Not "DJ" — that term is retired.

## Auto-DJ

The automated-playout feature (media library + scheduled playlists feeding a channel when no
streamer is live). The only surviving use of "DJ".

## Listener

Someone consuming a [Channel](#channel)'s audio output. Has no account and is never an
[Operator](#operator) — the two never overlap.
*Avoid:* "user" (that means an operator account), "audience member".
