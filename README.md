# multi_display_artworks
**Demo:** https://meta.juyounglee.net

3D virtual gallery where every wall, artwork, and element has its own web address. Built with A-Frame + Flask + MongoDB.

---

## Project Structure

```
multi_display_artworks/
├── README.md
├── flask_server/
│   ├── requirements.txt          # Python dependencies
│   ├── requirements_new.txt
│   ├── seed_data.py              # Seed initial data
│   ├── seed_and_serve.py         # Init DB + run server
│   └── app/
│       ├── app.py                # Flask app factory
│       ├── config.py             # App configuration (MongoDB URI, etc.)
│       ├── forms.py              # Flask-WTF forms
│       └── metamuseum/
│           ├── __init__.py       # App init, SocketIO, blueprint registration
│           ├── models.py         # MongoDB document models
│           │   ├── User
│           │   ├── Room
│           │   ├── Wall / Image / GaussianSplat / Video / Webpage
│           │   ├── Marker
│           │   ├── LocationPreset
│           │   ├── LLMConfig         (singleton: API keys, model, temperature)
│           │   └── WhisperConfig     (singleton: API keys, model, language)
│           │
│           ├── auth.py           # Login/register/activation logic
│           │
│           ├── core/              # Core business logic
│           │   ├── pyAframe.py       # A-Frame scene builder (wall, image, etc.)
│           │   ├── position_sync.py  # Socket.IO multi-user position sync
│           │   ├── streaming.py      # RTSP → HLS live streaming (FFmpeg)
│           │   ├── ar_proxy.py       # Vision Pro companion AR proxy
│           │   ├── mailing.py        # Email sending (SMTP)
│           │   └── ratelimit.py      # Rate limiting decorator
│           │
│           ├── elements/          # Element type logic
│           │   ├── basic.py          # CRUD for Wall, Image, GaussianSplat, Video, Webpage
│           │   └── user.py          # Camera position tracking
│           │
│           ├── views/            # Route handlers + Flask-Admin
│           │   ├── main_views.py     # /, /wall?wall_id=…, /room?room_id=…
│           │   ├── llm_layout.py     # /api/auto-layout, /api/apply-layout (MiniMax)
│           │   ├── whisper_views.py  # /api/transcribe (Whisper STT)
│           │   ├── stream_views.py   # /stream/* HLS and stream-control routes
│           │   ├── marker_views.py   # AR marker CRUD + marker tracking
│           │   └── ar_companion_views.py  # /room?ar=companion (Vision Pro)
│           │
│           ├── templates/        # HTML templates
│           │   ├── default/         # base, nav, footer, home
│           │   ├── auth/           # signin, register, activate
│           │   ├── admin/          # Flask-Admin custom index
│           │   ├── element.html        # Element admin page
│           │   ├── element_aframe.html # 3D element preview in A-Frame
│           │   ├── wall_aframe.html    # Wall with all elements rendered
│           │   ├── room_aframe.html   # Full room with all walls + elements
│           │   ├── ar_companion.html  # Vision Pro companion view
│           │   ├── aframe_test.html
│           │   ├── video_test.html
│           │   └── splat_example.html
│           │
│           └── static/
│               ├── gltf/         # Curated avatar assets; each asset keeps its license/attribution beside it
│               └── js/           # Client-side functionality
│                   ├── drag-component.js       # Admin drag-to-move (auth-gated)
│                   ├── location-features.js   # Teleport dropdown and boundary clamp
│                   ├── room/                   # ES-module room client: bootstrap, state/socket, rendering, interaction, UI
│                   ├── llm-layout.js           # LLM auto-layout UI (curator panel)
│                   ├── marker-ar.js            # AR.js marker detection + overlay
│                   ├── avatar-expression.js    # face-api.js smile detection → emoji bubble
│                   ├── voice-chat.js           # WebRTC audio + Whisper transcription
│                   ├── ar-receiver.js          # Vision Pro companion receiver
│                   ├── hide-on-play.js         # Hide UI while video plays
│                   └── play-on-click.js        # Click-to-start video audio

├── .venv/                        # Python virtual environment
└── CLAUDE_FILES/                 # Claude.ai agent memory
    └── CLAUDE.md
```

---

## Core Features

### 🎨 Element Types
| Type | Description | 3D Component |
|------|-------------|---------------|
| **Wall** | Container with position, size, rotation | `a-box` |
| **Image** | Image on wall, optionally draggable | `a-plane` with texture |
| **GaussianSplat** | 3D Gaussian splatting scene | `gaussian-splatting` component |
| **Video** | Video wall with HLS streaming support | `a-plane` + video element |
| **Webpage** | iframe embed via aframe-html-component | `a-html` |

### 👥 Multi-User
- **Position sync** — Socket.IO broadcasts camera pos/rot to all users in room
- **Tab-local visitor profile** — every room tab receives its own signed visitor capability and randomized name, catalog avatar, and color. The record lives in that tab’s `sessionStorage`, so reloading preserves it while a separately opened tab starts as a distinct visitor.
- **Profile editing** — rooms open directly without a profile dialog. Use `Visitor` → `Edit` in the top-left toolbar to change the name, catalog avatar, or color; saving updates that visitor’s remote presence for other people currently in the room. Use `?user=new` (or `Visitor` → `New visitor`) to replace the current tab’s visitor; the query flag is removed after the replacement is created.
- **Guest persistence** — anonymous visitor capabilities, profiles, and room presence are browser- or memory-scoped only; they never create MongoDB user or profile records.
- **Avatar catalog and attribution** — visitors can select only the built-in `Shiba`, `Robot`, `Rigged Simple`, or `None` entries; URL parameters such as `?avatar=` do not select an avatar. `Rigged Simple` is by Cesium under CC BY 4.0; its complete attribution is in [`flask_server/app/metamuseum/static/gltf/rigged-simple/LICENSE.md`](flask_server/app/metamuseum/static/gltf/rigged-simple/LICENSE.md).
- **Avatar expressions** — face-api.js smile detection → emoji bubble above avatar

### 🔐 Admin Features
- **Admin authentication** — sign in at `/signin`; only the existing administrator account can change gallery elements or control streams
- **Drag-to-move** — admin can drag any element (auth required, commit on mouseup)
- **Transform panel** — scale/rotate 6-field editor per element
- **QR Room Share** — generates local QR code (qrcode-generator library), no external API
- **LLM Auto-Layout** — curator types "place all images in a row" → MiniMax M2.7 arranges them
- **Voice chat admin toggle** — server-authoritative on/off switch

### 📡 Live Streaming
- RTSP stream URL → FFmpeg → HLS segments (`.ts`) → video element via HLS.js
- Admin sets `stream_url` on a Video element → auto detected and played

### 🤳 AR Features
- **AR.js marker detection** — camera sees Hiro/Kanji marker → overlay virtual content
- **Vision Pro companion** (`?ar=companion`) — passthrough AR with spatial content anchors
- **AR walking** — joystick-based movement in AR passthrough mode
- **Marker syncing** — physical marker → virtual content per element

### 🎤 Voice Chat
- **WebRTC** — direct P2P audio between users in same room
- **Socket.IO signaling** — WebRTC offer/answer/ICE exchange via Socket.IO
- **Server-authoritative toggle** — admin enables/disables per room
- **Whisper transcription** — MediaRecorder chunks → `/api/transcribe` → Whisper API → `voice.transcript` broadcast
- **Transcript bubbles** — 💬 text bubble above speaking avatar for 5 seconds

### 🏷️ Location & Movement
- **Location presets** — saved positions (name + camera vector) stored in MongoDB
- **Teleport dropdown** — jump to preset with one click
- **Boundary clamping** — `boundary-clamp` A-Frame component prevents user from leaving room
- **Expandable map** — the upper-right compact map opens a larger overview of the room, walls, artworks, presets, and your position. Opening it never changes or teleports the camera; use the named teleport dropdown to move to a preset.
- **Mobile movement guidance** — “Hold and drag to move” is shown only when both `(pointer: coarse)` and `(max-width: 767px)` match. It is absent for desktop pointer layouts.
- **Authorization unchanged** — these public visitor controls do not grant administration access; element transforms and stream controls remain restricted to the existing administrator authorization.

---

## Setup

```bash
cd flask_server
pip install -r requirements.txt
export SECRET_KEY='replace-with-a-random-secret-key'
export SECURITY_PASSWORD_SALT='replace-with-a-random-password-salt'
export MONGODB_URI=mongodb://localhost:27017/metamuseum
python seed_and_serve.py --serve
```

Requires non-empty `SECRET_KEY` and `SECURITY_PASSWORD_SALT` values (use unique
random values and keep them out of version control), plus a running **real
MongoDB** server. `MONGODB_URI` is the preferred connection setting;
alternatively configure `MONGODB_HOST`, `MONGODB_PORT`, and `MONGODB_DB`. To run
the integration suite locally, use a separate test database:

```bash
MONGODB_URI=mongodb://localhost:27017/metamuseum_test \
MONGODB_DB=metamuseum_test \
pytest tests -v
```

### Tab-local visitor smoke check

With the application running against `metamuseum_test`, open a seeded room and
verify the following in a browser:

1. The room opens without a profile dialog; `Visitor` reveals the summary and
   `Edit` reveals the profile form.
2. Save an edited profile, reload the same tab, and confirm the profile is
   retained.
3. Open the same room in a separate new tab and confirm it has a different
   visitor profile while both presences are visible.
4. Visit the room with `?user=new` and confirm a fresh visitor is created and
   the query flag is removed from the address bar.

For a self-contained dev stack (app + its own MongoDB):

```bash
export SECRET_KEY='replace-with-a-random-secret-key'
export SECURITY_PASSWORD_SALT='replace-with-a-random-password-salt'
docker compose up -d --build       # docker-compose.yml — dev only, empty DB
```

---

## Deployment

Pushing to `master` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):
the image is built and tested against an ephemeral `mongo:7` container on a
private Docker network. CI verifies `/health` and runs the pytest integration
suite against `metamuseum_test`; a **self-hosted runner** on the web server then
rebuilds and restarts the production container. If `/health` or `/` fails within
60s the previous image is restored automatically.

> **`docker-compose.yml` is the dev stack and brings up its own empty
> `mongo:7`. Production uses `docker-compose.prod.yml`**, which attaches to the
> long-lived `mongo_container` holding the real data. Do not deploy with the
> dev file.

Application code is baked into the image. Only secrets and the media that
MongoDB references by path are mounted from the host:

| Host path | Mounted at | Why |
|---|---|---|
| `data/metamuseum.env` | (env vars) | `config.py` reads all secrets from the environment |
| `data/static_splat/` | `…/static/splat` | `GaussianSplat 'hail_splat'` → `static/splat/hail.splat` |
| `data/static_image/` | `…/static/image` | `Image 'matisse_danceI'` → `static/image/dance_i.jpg` |
| `data/static_gltf/*.glb` | `…/static/gltf/*.glb` | `GLTFmodel 'dance'` → `static/gltf/matisse_dance.glb` |
| `data/streams/` | `/app/streams` | runtime scratch for HLS segments |

### First-time host setup

```bash
bash scripts/init_host_data.sh              # stages /var/www/metamuseum/data
$EDITOR /var/www/metamuseum/data/metamuseum.env   # fill in real secrets
docker compose -f docker-compose.prod.yml up -d --build
```

Apache reverse-proxies `meta.juyounglee.net` → `127.0.0.1:51736`, which maps to
port **5000** in the container (SocketIO/eventlet, see `flask_server/start.sh`).

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Home — room list |
| GET | `/health` | Application and MongoDB health check |
| GET | `/wall?wall_id=<id>` | Wall detail page |
| GET | `/room?room_id=<id>` | Full 3D room (A-Frame) |
| GET | `/room?room_id=<id>&ar=companion` | Vision Pro companion AR view |
| GET | `/room?room_id=<id>&ar=marker` | AR marker detection mode |
| GET, POST | `/signin` | Existing-account sign in |
| GET | `/logout` | Sign out |
| GET | `/kwanri` | Flask-Admin (administrator account required) |
| PATCH | `/element/<element_id>/<element_type>` | Update an element (administrator account required) |
| POST | `/api/auto-layout` | LLM auto-arrange elements |
| POST | `/api/apply-layout` | Apply LLM layout to DB |
| POST | `/api/transcribe` | Whisper audio → text |
| GET | `/api/whisper-config` | Get Whisper config |
| PUT | `/api/whisper-config` | Update Whisper config (admin) |
| POST | `/stream/push/<stream_id>` | Upload a phone-camera media segment (administrator account required) |
| POST | `/stream/start-rtsp` | Start RTSP-to-HLS conversion (administrator account required) |
| POST | `/stream/stop/<stream_id>` | Stop a stream (administrator account required) |
| GET | `/stream/playlist/<stream_id>` | Serve an HLS playlist |
| GET | `/stream/segment/<stream_id>/<segment>` | Serve an HLS segment |
| GET | `/stream/list` | List available streams |
| POST | `/camera-data` | Save camera position |
| GET | `/get-cameras` | Get recent camera positions |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SECRET_KEY` | Required non-empty Flask session-signing key |
| `SECURITY_PASSWORD_SALT` | Required non-empty salt for password and confirmation tokens |
| `MONGODB_URI` | Preferred MongoDB connection string (takes precedence over `MONGODB_HOST` and `MONGODB_PORT`) |
| `MONGODB_HOST` | MongoDB host when `MONGODB_URI` is not set (default: `localhost`) |
| `MONGODB_PORT` | MongoDB port when `MONGODB_URI` is not set (default: `27017`) |
| `MONGODB_DB` | MongoDB database name (default: `metamuseum`; tests require `metamuseum_test`) |
| `MAIL_*` | SMTP邮件配置 |
| `MINIMAX_API_KEY` | MiniMax API key (legacy, DB config preferred) |

---

## TODO

### ✅ Completed
- [x] Drag to move images/wall/gaussiansplat — `drag-component.js`, admin-only via auth
- [x] Video background contents on wall — `stream_url` on Wall/Video model
- [x] Add auto-refresh on wall page — JS refresh with ETag check
- [x] Webpage wall element type — iframe via aframe-html-component
- [x] Cutout option for GaussianSplat — UI in element page (admin)
- [x] Hand tracking — MediaPipe via avatar-expression.js
- [x] Browser visitor profile — browser-only name, catalog avatar, and color with live room presence updates
- [x] Add some additional marker add-on for each images (QR or synchro) — webpage element
- [x] Text(relationship) based auto images placement (LLM powered) — llm_layout.py
- [x] AR walking (joystick) — location-features.js
- [x] Save user position/rotation tracking — /camera-data endpoint
- [x] Automatic screen size fitting — responsive A-Frame scene
- [x] MongoDB abstract class for wall elements — WallElement base
- [x] Scale/rotate transform controls — 6-field transform panel

### 🔄 In Progress
- Vision Pro companion: SocketIO wiring + ar-receiver.js

### 🎯 Backlog
- [ ] QR/marker syncing — physical device detection → content overlay per element
- [ ] Face-api.js offline model files
- [ ] Remove deprecated HTTP polling endpoints (use Socket.IO instead)
- [ ] Multi-user real-time element transforms (shared drag session)
- [ ] aframe-click-drag-component for wall-level dragging

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| 3D Rendering | A-Frame 1.6.0 |
| Gaussian Splatting | aframe-gaussian-splatting |
| AR | AR.js 3.4.7 |
| Backend | Flask + Flask-SocketIO (eventlet) |
| Database | MongoDB (PyMongo) |
| Admin | Flask-Admin |
| Real-time | Socket.IO |
| WebRTC Audio | Native browser WebRTC |
| Speech-to-Text | Whisper API (OpenAI-compatible) |
| LLM | MiniMax M2.7 via REST API |
| Live Streaming | FFmpeg → HLS → HLS.js |
| QR Codes | qrcode-generator (local, no external API) |
| Avatar Expressions | face-api.js 0.22.2 |

---

## Acknowledgment

This work was supported by Institute of Information & communications Technology Planning & Evaluation (IITP) grant funded by the Korea government(MSIT) (No.2019-0-01270, WISE AR UI/UX Platform Development for Smartglasses)
