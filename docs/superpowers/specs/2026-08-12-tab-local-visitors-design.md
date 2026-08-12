# Tab-local visitor identities

## Goal

Let each browser tab participate as its own visitor while keeping that tab's
identity stable across reloads. Visitors start with a random, usable profile;
profile editing is available on demand rather than shown by default.

## Scope

This changes anonymous visitor identities and the visitor-profile interface.
It does not add database-backed guest accounts, alter admin authentication, or
persist guest profiles to MongoDB.

## Identity model

The browser stores one visitor record per tab in `sessionStorage`. The record
contains a signed server-issued visitor capability, its opaque visitor ID, and
the generated profile. `sessionStorage` makes a reload in the same tab retain
the identity while a separately opened tab begins with no record and therefore
receives a new identity.

On first entry, and whenever the URL contains `?user=new`, the client requests
a new capability and generates a new default profile. It replaces the current
history entry with the same URL without `user=new`, so refreshes keep the newly
created visitor rather than creating another one.

The server validates the capability at the Socket.IO handshake and associates
the validated visitor ID with the socket. Join and profile-update messages must
ignore any caller-supplied visitor ID. Invalid, expired, or absent capabilities
are rejected before room presence is created.

This replaces the existing browser-wide Flask-session visitor identity for
realtime presence. Two valid tab capabilities in the same browser may join a
room at once. A second connection for the *same* capability retains the
existing duplicate-connection behavior, so a reload cannot leave a duplicate
presence behind.

## Default profile and editing

New visitors receive a randomly selected display name, avatar, and color:

- Names are generated from a small safe vocabulary plus a short numeric suffix
  and comply with the existing profile validation rules.
- The avatar is selected from the available avatar catalogue, excluding the
  hidden/empty avatar as a default choice.
- Color is selected from a predefined accessible palette accepted by the
  current color validation.

The room opens directly with this profile. It must not display a profile editor
or an `Edit profile` prompt on first entry. The compact `Visitor` toolbar
control opens a visitor panel showing the active identity and its preview.
Within that panel:

- `Edit` reveals the existing display-name, avatar, and color controls.
- `Save` validates and updates the current tab's profile and broadcasts the
  permitted profile fields to the room.
- `New visitor` creates a new signed capability and random profile for the
  current tab, persists it to `sessionStorage`, clears `user=new` if present,
  and reconnects/reloads the room so the old presence leaves and the new one
  joins cleanly.

There is no profile editor visible until the user selects `Visitor` and then
`Edit`.

## Client and server boundaries

- A dedicated client visitor-session module owns `sessionStorage`, URL
  normalization, random default-profile generation, and calls to the
  visitor-capability endpoint.
- The profile UI consumes that module rather than directly accessing global
  browser storage or Flask session data.
- The Socket.IO bootstrap obtains the capability before connecting and passes
  it only through Socket.IO `auth`; it owns reconnecting after `New visitor`.
- A focused backend capability service owns issuance, signing, expiry, and
  validation. Socket handlers consume its validated identity rather than
  importing HTTP-session helpers.

The anonymous identity remains browser-only except for the signed capability;
no visitor profile collection or user-account record is written to MongoDB.

## Errors and recovery

If capability issuance or validation fails, the room reports a clear connection
error and does not publish presence. The client may mint a replacement only
after an explicit retry or `New visitor` action; it must not silently loop.
Malformed stored records are discarded and replaced with one new visitor.

## Tests and verification

Add or update tests for:

1. First entry: valid randomized name/avatar/color, no default edit panel, and
   no MongoDB guest-profile write.
2. Same-tab reload: the existing `sessionStorage` record and identity are
   reused.
3. New tab / empty `sessionStorage`: a distinct identity can join the same room
   concurrently without displacing the first.
4. `?user=new` and `New visitor`: each replaces the current tab identity and
   removes the query flag from the visible URL.
5. Socket security: forged caller visitor IDs and invalid/expired capabilities
   cannot create or alter presence.
6. UI states: the visitor panel is opt-in; `Edit` exposes controls; `Save`
   broadcasts the validated profile.

Run the complete JavaScript browser-unit suite and the complete Python suite
against the configured real MongoDB instance. Also run formatting/diff checks
and inspect the working tree before committing.

## Acceptance criteria

- Reloading one tab preserves that tab's visitor and profile.
- A newly opened tab becomes a different visitor by default.
- `?user=new` and the Visitor-panel action make a fresh visitor in the current
  tab without leaving a duplicate room presence.
- Visitors are randomized by default and editing is never shown automatically.
- Multiple anonymous visitors can coexist in one room, while a duplicated
  connection for one capability is still de-duplicated.
- Guest activity does not create MongoDB user/profile records.
