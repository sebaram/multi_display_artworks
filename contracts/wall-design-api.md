# Wall design / editor / realtime integration contract

Approved product behavior: all room visitors share pointer reactions and canonical video play/pause/seek; YouTube opens a separate player. Admins author/save/apply/control playback. This fixes interfaces for Tasks 6b, 7 and 8.

## Look and persistence

`WallLookV1 = {schema_version:1,source_commit:'b247fd238fe6cb2c8c860c77d13488b28b8a0290',logical_screen:string,seed:integer0..999999,state:<original normalized state>}`. Engine `normalizeWallLook` is the client boundary. Backend validates the same field limits, finite numbers, selected screen and source version. Plain original state is accepted only at import normalization boundary. Runtime selection/edit flags and undo/history are not durable.

`WallPresetRead = {id,name,revision,read_only,source_key:null|string,schema_version:1,renderer_version,config:WallLookV1,asset_ids:string[],thumbnail_asset_id:null|string,thumbnail_url:null|string,created_at,updated_at}`.

- `GET /api/v1/wall-presets` → `WallPresetRead[]` (44 system defaults plus custom).
- `GET /api/v1/wall-presets/{id}` → detail.
- `POST /api/v1/wall-presets` JSON `{name,config,thumbnail_asset_id?}` → created read DTO201.
- `PATCH /api/v1/wall-presets/{id}` JSON `{name?,config?,thumbnail_asset_id?,expected_revision}` → saved DTO;409 if stale. Read-only defaults cannot be modified; copy through POST.
- `DELETE /api/v1/wall-presets/{id}?expected_revision=N` →204; read-only defaults cannot be deleted. Existing bindings keep their immutable snapshots.
- `POST /api/v1/wall-presets/import` JSON `{name,config}` (config may be original raw state) → created DTO201.
- `GET /api/v1/wall-presets/{id}/export` → attachment JSON `{name,config}`.

Public list/detail/export are safe read access; writes require current admin, Origin and X-CSRF-Token. Asset references must exist before saving; blob URLs cannot persist.

`AppliedWallDesign = {wall_id,room_id,revision,preset_id:null|string,preset_revision:null|number,config:WallLookV1,asset_ids:string[],logical_screen,seed,animation_epoch_ms,playback:PlaybackState}`. `revision` is the binding revision used as `binding_revision` in events. Configuration seed equals binding seed.

- `GET /api/v1/walls/{id}/design` → `AppliedWallDesign|null`.
- `PUT /api/v1/walls/{id}/design` JSON `{preset_id?,config?,expected_revision}` → applied DTO. When no binding exists expected_revision=0. Supply either preset_id (published preset snapshot) or config (explicit draft apply). Saving a preset alone never applies it.
- `DELETE /api/v1/walls/{id}/design?expected_revision=N` →204 and room notification; restores unchanged legacy background media. Existing artwork/physical wall geometry stays untouched.
- Task7 adds the same applied DTO to existing RoomScene WallDTO.design and standalone wall detail.

## Assets

- `GET /api/v1/wall-assets` → metadata array `{id,name,content_type,size,url,created_at}` (admin).
- `POST /api/v1/wall-assets` multipart field `file` → metadata201 (admin/CSRF); streamed, MIME/signature/size/quota checked. Image thumbnails and uploaded video supported.
- `GET /api/v1/wall-assets/{id}/content` → same-origin public bytes, correct MIME, Range206 for video.
- `DELETE /api/v1/wall-assets/{id}` →204;409 if referenced by a preset or binding. No untrusted path component is used on disk.

JSON/metadata in MongoDB; bytes in persistent wall_media volume. Source default clip metadata is not a locally uploaded asset. Existing gallery media stays at its original paths. Only engine `state.videoLayers[].assetId` represents new durable uploaded videos; changing source must clear the old assetId/YouTube/customClip state using the exported source helper.

## Shared room state

Task3 exposes HTTP app state.realtime with async `broadcast(event,payload,room_id,skip_sid=None)` and `get_room_visitor(sid,room_id) -> VisitorIdentity|None`, plus state.sio. Task8 attaches wall events through that existing server and room transport.

At valid join/reconnect, server additionally emits `wall.snapshot` to that visitor: `{room_id,server_time_ms,walls:[{design:AppliedWallDesign,interaction:InteractionState}]}`. Task8 handler is injected into Task3 join lifecycle (callback registration), avoiding a second presence handler. Existing room_state user payload is unchanged.

- Client `wall.interaction`: `{wall_id,binding_revision,client_seq,kind:'move'|'leave',uv?:{u,v}}`; visitor capability + actual room membership + wall's room + enabled interactive look required.
- Server `wall.interaction_state`: `{wall_id,binding_revision,runtime_id,sequence,server_time_ms,pointer:{x,y},seed,animation_epoch_ms,active_until_ms}`. Latest accepted input wins;20Hz coalesce;3s idle/active-visitor leave resets center. UV maps x=u-.5,y=.5-v.
- Client `wall.playback_command`: `{wall_id,binding_revision,expected_playback_revision,action:'play'|'pause'|'seek',position_seconds?}`; current admin session+CSRF-authenticated socket+room membership required. Callback acknowledgement is `{ok:true,state:PlaybackState}` or `{ok:false,status,detail}`.
- Server `wall.playback_state`: `PlaybackState = {wall_id,binding_revision,revision,playing,position_seconds,rate,state_time_ms}`. Persist canonical state in binding; stale command409. Position at server time now is position_seconds+(playing?(now-state_time_ms)/1000*rate:0).
- Server `wall.design_applied`: full AppliedWallDesign plus `server_time_ms`; replace only that wall's engine config and playback. Server `wall.design_removed`: `{wall_id,room_id,revision,server_time_ms}`; dispose wall engine and restore original background.
- Client `wall.clock` callback echo `{server_time_ms}`; estimate offset using request midpoint/RTT, refresh on reconnect and periodically. Both renderer and media use this estimated canonical clock rather than accumulating local frame deltas.

Animation timeline derives from applied config: `state.offset + (state.paused ? 0 : max(0,server_now-animation_epoch_ms)/1000 * state.speed)`. Media clock is separately persisted/shared by PlaybackState. Drift>0.5s seeks; YouTube iframe buffering/seek resolution is an explicit tolerance, not frame-perfect output. Local unmute remains a user gesture. Initial playback mirrors applied source state (playing=!paused, position=offset, rate=speed); apply resets its canonical epoch.

Admin Socket.IO handshake uses signed session cookie plus `auth.csrfToken` and allowed Origin. All visitors still send `auth.visitorCapability`; no admin rights inferred from profile. If no applied design exists, snapshots contain no design for that wall. New collection pointer state stays runtime-only; video clock changes are durable.
