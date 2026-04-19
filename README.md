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
│           │   ├── main_views.py     # /, /wall/<id>, /room/<id>, /admin
│           │   ├── llm_layout.py     # /api/auto-layout, /api/apply-layout (MiniMax)
│           │   ├── whisper_views.py  # /api/transcribe (Whisper STT)
│           │   ├── stream_views.py   # /api/stream-manifest, /api/upload-segment
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
│               ├── gltf/shiba/   # Default avatar GLTF + license
│               └── js/           # Client-side functionality
│                   ├── drag-component.js       # Admin drag-to-move (auth-gated)
│                   ├── location-features.js   # Teleport dropdown, boundary clamp, mini-map
│                   ├── guest-name.js           # Name prompt, Socket.IO displayName
│                   ├── share-qr.js             # QR code generation (local, no external API)
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
- **Avatar name tags** — green floating name label (GuestName component)
- **Guest names** — prompted on first visit, stored in SessionStorage, sent via Socket.IO `displayName`
- **Avatar expressions** — face-api.js smile detection → emoji bubble above avatar

### 🔐 Admin Features
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
- **Mini-map** — top-down SVG minimap showing user position + walls

---

## Setup

```bash
cd flask_server
pip install -r requirements.txt
python seed_and_serve.py
```

Requires **MongoDB** running. See `config.py` for MongoDB URI and secret key configuration.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Home — room list |
| GET | `/wall/<id>` | Wall detail page |
| GET | `/room/<id>` | Full 3D room (A-Frame) |
| GET | `/room/<id>?ar=companion` | Vision Pro companion AR view |
| GET | `/room/<id>?ar=marker` | AR marker detection mode |
| GET | `/admin` | Flask-Admin (CRUD all models) |
| POST | `/api/auto-layout` | LLM auto-arrange elements |
| POST | `/api/apply-layout` | Apply LLM layout to DB |
| POST | `/api/transcribe` | Whisper audio → text |
| GET | `/api/whisper-config` | Get Whisper config |
| PUT | `/api/whisper-config` | Update Whisper config (admin) |
| GET | `/api/stream-manifest/<room_id>` | Get HLS stream URL |
| POST | `/api/upload-segment` | Upload HLS segment |
| GET | `/camera-data/<room_id>` | Get user camera positions |
| POST | `/camera-data/<room_id>` | Save camera position |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SECRET_KEY` | Flask secret key |
| `MONGO_URI` | MongoDB connection string |
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
- [x] Avatar customization — guest name + expression emoji
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
| Backend | Flask + Flask-SocketIO (gevent) |
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