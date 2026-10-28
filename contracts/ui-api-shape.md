# React / gallery API integration contract

This contract fixes the interface between Tasks 2 and 5 before those workers edit separate directories. FastAPI OpenAPI remains the generated type source. Existing URL query aliases remain valid.

## Public gallery

- `GET /api/v1/rooms` → `RoomSummary[]`, each `{id,name,description,walls:[{id,name}],created_time}`.
- `GET /api/v1/rooms/{id}/scene?ar=marker|companion&preset=<id>&debug=sync` → `RoomScene`.
- `GET /api/v1/walls/{id}` → `WallDetail`, same Wall DTO below plus room summary and current applied design or null.
- `GET /api/v1/elements/{type}/{id}` → `ElementDetail`, same Element DTO below plus wall/room IDs.
- invalid ObjectId returns400, valid missing ID404; no SPA fallback for unknown `/api/` requests.

`RoomScene` preserves existing bootstrap spelling for modules:

```text
room: {id,name,description}
roomId: string
boundary: {min_x,max_x,min_y,max_y,min_z,max_z}
presets: LocationPresetDTO[]
spawn_preset: LocationPresetDTO|null
walls: WallDTO[]
wallList: minimap-compatible wall summaries
visitorCapabilityUrl: "/visitor-capability"
avatarCatalog: ["shiba","robot","rigged-simple","none"] (use actual existing catalogue IDs)
isAdmin: boolean
syncDebugEnabled: boolean
isArMarker: boolean
isArCompanion: boolean
roomControlsEnabled: boolean
```

Wall DTO: flat existing editable model fields, `id` as string, `room` as ID, `elements: ElementDTO[]`, `design: AppliedWallDesign|null`. `images/splats/gltfs/webpages` retain ordered ID lists when present. Vector `position/rotation` remain strings in database/public DTO, scene adapter parses them.

Element DTO: `id`, actual `wall_element_type` (`image`, `gaussian_splat`, `gltf`, `webpage`), `wall` ID and existing flat fields including position/position_x/y/scale/rotation and type-specific media source. Public DTO never contains user password/provider api_key. LocationPreset retains its existing `to_dict()` representation.

## Admin resources

Canonical slugs: `rooms`, `walls`, `images`, `splats`, `gltfs`, `webpages`, `locations`, `effects`, `markers`, `llm-configs`, `whisper-configs`.

- `GET /api/v1/admin/schema` → `{resources:[{name,label,fields:[FieldSpec]}]}`.
- `GET /api/v1/admin/{resource}?offset=0&limit=50` → `{items: DocumentDTO[],total:number}`; limit<=200.
- `GET /api/v1/admin/{resource}/{id}` → flat DocumentDTO.
- `POST /api/v1/admin/{resource}` → created DocumentDTO, status201.
- `PATCH /api/v1/admin/{resource}/{id}` → saved DocumentDTO.
- `DELETE /api/v1/admin/{resource}/{id}` → status204; referenced parent deletion may return409 with explanation rather than silently deleting other content.

FieldSpec: `{name,label,type,required,readonly,default?,choices?,reference?,secret?}`. Supported types: string, text, number, boolean, reference, reference-list, json, datetime, password. `reference` is canonical resource slug. `_id`/timestamps and relationship-maintained lists can be readonly. Registry is explicit allowlist; no arbitrary model/collection names or raw Mongo operators from requests.

Writes use `X-CSRF-Token` from `/api/v1/auth/csrf`, same-origin credentials and backend validation. Schema GET also requires administrator. Existing `/kwanri[/<legacy-resource>[/new|edit]]` links open corresponding new app screen. Existing HTTP mutation aliases are preserved where task2's legacy contract requires them.

Admin reads mask provider secrets too: include `has_api_key`, never the actual key. Empty api_key in edit means retain; creation still validates required secret. Relationships are updated in both directions. Model validation errors return422 with safe field messages; DB unique conflicts409; no exception strings containing credentials.

## Wall renderer / presets

WallLookV1 envelope: `{schema_version:1,source_commit,logical_screen,seed,state:<original sanitized reference state>}`. Plain reference JSON is normalized at import boundary. Binding seed equals envelope seed.

Renderer: `createWallRenderer({canvas,config,assetResolver,onError})` returns setConfig/resize/setInteraction/render(timeSeconds,playback?)/dispose and getElements()/pick(normalizedX,normalizedY). Playback argument `{positionSeconds,playing,rate}` is already evaluated against server clock. Separate YouTube iframe adapter consumes the same clock.

Pointer state and uploaded-video/YouTube play/pause/seek are shared within room. Admin-only playback commands, canonical server clock and optimistic revisions are defined in spec §8. New API `/api/v1/wall-presets`, `/api/v1/walls/{id}/design`, `/api/v1/wall-assets` follow Task7; UI draft saving never implicitly applies to live walls.
