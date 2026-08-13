# Position Sync Smoothing Design

## Goal

Make remote avatars move smoothly and respond promptly, without adding
infrastructure. Today every client emits its pose on a fixed 100 ms timer
whether or not it moved, and each arriving packet hard-sets the remote avatar's
transform. Remote visitors therefore teleport ten times a second, and an idle
room still pays full network and DOM cost.

This work is entirely client-side. The Socket.IO wire format, the server
handlers in `core/position_sync.py`, and the presence service are unchanged.

## Why not WebRTC

A WebRTC data channel was considered first. It would save roughly one server hop
and, more importantly, avoid TCP head-of-line blocking on lossy venue WiFi.
Neither effect is visible while the client renders at a fixed 10 Hz with no
interpolation: a faster transport would only deliver stale samples sooner.

The transport question is deferred, not dismissed. The debug overlay specified
below produces the send-rate, receive-rate, and staleness numbers needed to
judge a transport change on evidence. A data channel remains cheap to add later
because the room already runs a WebRTC mesh with working signaling
(`voice.offer` / `voice.answer` / `voice.ice` in `core/position_sync.py`).

## Current behavior

- `static/js/room/interaction/hand-tracking.js:147` — a 100 ms `setInterval`
  publishes `position_update` unconditionally, moving or not.
- `core/position_sync.py:188` — the server rebroadcasts each packet to every
  other client in the room.
- `static/js/room/bootstrap.js:153` — each arriving packet calls `renderUsers()`.
- `static/js/room/rendering/scene.js:103` — `renderUsers()` hard-sets
  `position` and `rotation` via `setAttribute`, and re-walks every user on every
  packet.
- `static/js/room/rendering/scene.js:60` — `updateHands()` removes and
  recreates both hand entities on every call.

## Design

### Send side: `core/pose-publisher.js`

A pure module with no DOM or socket dependency. It answers one question: given
the current pose, the last pose actually sent, and the current time, should this
sample go out?

A sample is sent when any of these holds:

- position moved more than `POSITION_EPSILON` (0.01 m) on any axis
- rotation changed more than `ROTATION_EPSILON` (0.5°) on any axis
- `HEARTBEAT_MS` (1000 ms) has elapsed since the last send

Sends are rate-capped to `MAX_SEND_HZ` (20 Hz). The heartbeat is not optional:
server-side presence, `room_state` for late joiners, and the AR proxy all read
the last known pose, so a stationary visitor must keep asserting it.

A stationary visitor drops from 10 packets/s to 1. A moving one doubles from
10/s to 20/s.

### Receive side: `core/pose-buffer.js`

Also pure. Per user it keeps a short ring of timestamped samples and exposes
`poseAt(userId, renderTime)`.

Rendering runs `INTERPOLATION_DELAY_MS` (100 ms) behind wall clock, so under
normal conditions two samples bracket the render time and the pose can be
interpolated between them: position by linear interpolation, rotation by
shortest-arc spherical interpolation, so 179° to -179° takes the 2° path rather
than spinning 358°.

When the buffer holds nothing newer than the render time, the last known pose is
**held, not extrapolated**. A briefly frozen avatar reads as network trouble; an
avatar that overshoots and snaps back reads as a bug.

The buffer tolerates duplicate and out-of-order arrivals, which matters now for
reconnects and would matter more on an unordered transport later.

### Render side

`rendering/scene.js` splits its single `renderUsers` entry point in two:

- **`syncRoster(users)`** — creates and removes remote camera entities, applies
  profile changes, and updates hands. Runs on roster events only: join, leave,
  profile update, and full `room_state`.
- **`applyPoses(poses)`** — writes position and rotation only. Runs once per
  frame.

`updateHands` becomes change-gated on a key derived from the hand payload, so it
stops rebuilding DOM on every call. Under a per-frame loop the current
unconditional rebuild would be ruinous.

A new `rendering/render-loop.js` drives `applyPoses` from
`requestAnimationFrame`, reading each user's pose from the buffer at
`now - INTERPOLATION_DELAY_MS`. It writes through `object3D.position` and
`object3D.rotation` when present, falling back to `setAttribute`. A-Frame's
attribute path is too slow to touch every frame; the fallback keeps the
DOM-stub tests and the marker-AR path working.

### Wiring

- `hand-tracking.js` routes its publish through `pose-publisher`. The XR hand
  payload keeps its own 10 Hz cadence — hand skeletons are large and gain little
  from 20 Hz.
- `bootstrap.js` feeds `position_update` into the pose buffer instead of calling
  `renderUsers`. Join, leave, and profile events continue through `room-state`
  and trigger `syncRoster`.

### Constants

All tunables live in one exported block so they can be adjusted without
searching: `POSITION_EPSILON`, `ROTATION_EPSILON`, `HEARTBEAT_MS`,
`MAX_SEND_HZ`, `INTERPOLATION_DELAY_MS`, `BUFFER_SIZE`.

## Load trade-off

Peak server fanout rises. With 8 visitors all moving continuously, outbound
emits go from 560/s (8 × 10 × 7) to 1120/s (8 × 20 × 7). Average load falls,
because exhibition visitors are stationary most of the time and stationary
clients now send at 1 Hz instead of 10 Hz. `MAX_SEND_HZ` is the dial if the
single eventlet worker shows strain.

## Debug overlay

Enabled by `?debug=sync` on the room URL, off otherwise. It reports send rate,
receive rate, per-peer sample staleness, and the active interpolation delay.
This is the measurement instrument for any future transport decision.

## Testing

`npm run test:js` (`node --test tests/js/*.test.mjs`) covers:

- `pose-publisher` — each threshold independently, heartbeat while stationary,
  rate cap under continuous motion.
- `pose-buffer` — interpolation between bracketing samples, shortest-arc
  rotation across the ±180° seam, duplicate and out-of-order arrivals, stale
  hold rather than extrapolation, ring eviction.
- `scene` — the roster/pose split, and that `updateHands` does no DOM work when
  the hand payload is unchanged.
- `bootstrap` — a `position_update` packet reaches the buffer and triggers no
  render work.
- `module-boundaries` — the new modules stay within the established import
  rules.

Manual check in a room with two browser tabs: an avatar crossing the room moves
continuously rather than in visible steps, and a stationary avatar does not
drift or jitter.

## Out of scope

- WebRTC data channel transport (deferred; see above)
- TURN configuration in `getRTCConfig()` (`static/js/voice-chat.js:99`)
- Server-side changes of any kind
- Interest management or area-of-interest filtering
