# Browser Profile and Room Modularity Design

## Goal

Improve the public room experience without changing the existing admin-only
authorization model. Visitors receive a stable, browser-local identity and can
customize their visible presence. The room client gains an expandable minimap
and mobile-only movement guidance. The implementation also creates clear seams
for gradual frontend and backend modularization.

## Scope and delivery order

This work is split into two independently deployable phases.

1. **Visitor profile and room controls**: browser-local profile, avatar and
   color selection, editable name panel, secure real-time presence payload,
   expandable minimap, and mobile-only drag guidance.
2. **Structural modularization**: move the room's inline and global browser
   code into focused modules, then extract backend profile/presence services
   behind stable route and Socket.IO interfaces.

Phase 1 must retain Flask templates and the existing public room URL. Phase 2
must preserve those interfaces while changing only internal organization.

## Visitor profile

On the first room visit, Flask issues an opaque `visitorId` in its signed
browser session cookie. The browser stores the associated profile in
`localStorage`; the stored profile fields are:

```json
{
  "displayName": "Visitor name",
  "avatarId": "robot | shiba | rigged-simple | none",
  "color": "#RRGGBB"
}
```

No visitor profile data is stored in MongoDB. Clearing this browser's site data
resets the profile and the signed browser session identity; this is intentional.
The visitor identity and profile do not restore across devices. They are not a
login or user account. Flask-Login users continue to be used only for
authentication and administrative authorization.

The first visit opens a profile dialog. Subsequent visits display a compact
top-left profile panel with the selected name, avatar swatch, and an Edit
button. Validation is client-side and mirrored at the real-time boundary:

- display name: 3–20 allowed characters;
- avatar: an entry in the application-owned catalog only;
- color: normalized six-digit hex color only.

The Socket.IO server reads the signed session identifier and binds it to the
socket connection. It does not trust any client-supplied `userId`. It accepts
validated profile attributes and broadcasts the normalized presence state. A
client may only update its own connected presence.

## Avatar catalog and assets

The client receives a small, versioned avatar catalog from the room bootstrap
data. The initial catalog contains only `shiba`, a configurable primitive
`robot`, the CC-BY-4.0 `Rigged Simple` model, and `none`; it does not accept
avatar selection through a `?avatar=` query parameter or arbitrary URLs. The
`Rigged Simple` model's Cesium attribution and licence are recorded beside the
asset in `flask_server/app/metamuseum/static/gltf/rigged-simple/LICENSE.md`.
Only additional glTF assets committed with a license and attribution record may
be added. The renderer receives an `AvatarProfile` and owns how each entry is
built:

- primitive avatars apply the selected color directly to their materials;
- glTF avatars apply color only to approved material targets or use a color
  accent, never arbitrary URL or material input;
- unsupported assets fall back safely to `robot`.

Assets are curated manually from sources with explicit model-level licences;
the catalog records source URL, creator, licence, and attribution text beside
each imported file. The app never downloads arbitrary model URLs at runtime.

## Room controls

### Expandable mini-map

The existing compact canvas remains in the upper-right corner. Clicking it
opens a modal map up to 80 viewport units wide/high, with the same room bounds,
walls, artworks, presets, player marker, and a concise legend. It closes by
close button, backdrop click, or Escape. The compact-map click no longer
teleports the visitor; teleport remains available through the named preset
control.

### Mobile guidance

The phrase “Hold and drag to move” appears only when **both** media queries
match: `(pointer: coarse)` and `(max-width: 767px)`. It is implemented as a
responsive hint and is never rendered for desktop mouse/keyboard visitors.
Administrative element transform dragging remains independently admin-gated and
is not enabled for ordinary visitors.

## Modularity target

The current room template owns camera setup, avatar rendering, Socket.IO,
profile behavior, controls, and several global scripts. The target boundaries
are:

```
frontend/
  core/           room bootstrap, profile store, API and Socket.IO clients
  rendering/      A-Frame scene, avatar renderer, minimap renderer
  interaction/    teleport, mobile movement guidance, admin transforms
  ui/             profile panel, dialogs, notifications

backend/
  views/          thin HTTP route adapters
  services/       profile normalization and room query use-cases
  realtime/       socket presence gateway and room state
```

Flask remains the initial frontend host. ES modules replace global script
ordering and pass dependencies explicitly. Backend route URLs and Socket.IO
event names remain backward compatible during extraction. Later, a standalone
frontend build is a separate decision and not part of this scope.

## Error handling and accessibility

- Invalid or corrupted local profile data is replaced with a safe default and
  the visitor can immediately edit it.
- A failed real-time profile update keeps the local draft, shows an actionable
  error, and retries on the next socket connection.
- The profile dialog and expanded map are keyboard operable, return focus to
  their launcher, and have accessible labels.
- The UI never exposes administrative controls based solely on client state.

## Acceptance criteria

1. A visitor receives the same opaque ID across room reloads in one browser,
   and no guest profile collection is created in MongoDB.
2. A visitor can edit their display name, avatar, and color; remote room users
   receive the resulting normalized profile state.
3. A malicious `userId` sent after joining cannot impersonate another visitor.
4. The mini-map opens a large overview without changing the camera position.
5. The movement hint is visible only on mobile/coarse-pointer layouts.
6. Phase 1 regression tests run against the existing real MongoDB test setup;
   JavaScript units cover profile validation, profile persistence, and renderer
   selection.
7. Phase 2 leaves public route and real-time contracts intact while removing
   room-level global coupling.
