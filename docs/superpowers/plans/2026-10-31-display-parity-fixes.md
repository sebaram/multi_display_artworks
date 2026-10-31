# TV display and responsive parity fixes

The accepted scope is findings R1–R5 in `docs/reports/mobile-desktop-tv-comparison-results.json`, baseline a0a762c. Keep the earlier audit artifacts as historical evidence. Continue on the existing development branch; no push or deployment is requested.

- [x] R1: Make standalone walls use a viewport-aware fit camera and a clean TV display, including resize and portrait screens.
- [x] R2: Restore contained image display for default image element URLs; retain `display_type=aframe` and other element types.
- [x] R3: Receive wall design, interaction and playback updates without room visitor/profile/avatar/voice membership. Display sockets must remain read-only and scoped to the requested wall.
- [x] R4: Prevent voice controls and minimap from covering the open mobile artwork inspector.
- [x] R5: On a Windows open-file delete failure, retain the asset record and return a recoverable response; do not lose metadata before file removal.
- [x] Focused regressions, production frontend build, short browser smoke for corrected flows, and concise verification record.

Implementation boundaries: root owns Room.tsx, mountRoom.ts and display-only realtime subscription; image task owns the element route entry and new contained-image component; overlay task owns only mobile overlay CSS; media task owns wall_media deletion service and focused isolated tests. No task edits another task's owned implementation. Root reviews the combined diff.

Rulings: existing signed room membership remains mandatory for publishing wall interactions and playback commands. A public display subscription may receive public wall state but cannot acquire visitor authority. The TV route hides room navigation controls by default because its intended use is unattended display. Existing wall URLs and refresh parameters stay valid. The full prior CI's three failures and unconfirmed near-avatar/spawn visual observations are outside the five reproduced fixes; do not claim them solved.

Validation preference: focused tests and affected browser flows only. Do not reset the shared test DB or access physical devices. Use uniquely named local fixtures and delete only owned records. Backend tests must not request shared database/app/client reset fixtures.

Completion: frontend44/backend21 focused checks, final type/build success, actual TV fit98% in both viewports, shared pointer/MP4/reconnect without visitors, 2D/explicit3D image routes, mobile save hit, Windows locked-delete409 then204. Review found a removed YouTube entry; restored as a read-only TV viewer and covered it. Old wall-profile/draft tests were replaced by display-only expectations; explicit3D element profile regression remains. A legacy selected-artwork query cannot enable hidden keyboard editing in TV mode. The pixel check also caught and fixed intrinsic grid sizing for images. Details and limits are in `docs/reports/display-fix-verification.json`.
