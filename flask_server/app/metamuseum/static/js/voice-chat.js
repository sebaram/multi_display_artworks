/* Voice Chat via WebRTC — microphone audio between users in same room

Architecture:
1. Socket.IO handles signaling (offer/answer/ICE candidates)
2. WebRTC RTCPeerConnection for audio streams (P2P when possible, TURN relay when needed)
3. Local microphone toggle, mute button, voice activity indicator

Signaling events (via Socket.IO):
- voice_join      → user wants to join voice
- voice.offer     → WebRTC offer from caller
- voice.answer    → WebRTC answer from callee
- voice.ice       → ICE candidate exchange
- voice.leave     → user left voice
- voice.mute      → user muted/unmuted
- voice.admin_toggle → admin enables/disables voice for room
*/

// ─── Config ────────────────────────────────────────────────────────────────────

var VoiceChat = {
  enabled: false,        // admin must enable
  active: false,         // user joined voice
  muted: true,           // microphone muted
  localStream: null,     // microphone stream
  peers: {},             // peerId → RTCPeerConnection
  peerStreams: {},       // peerId → remote stream
  roomId: null,
  userId: null,
  isAdmin: false,
  transcriber: null,     // MediaRecorder for Whisper
  lastTranscriptTime: 0
};

// ─── Init ──────────────────────────────────────────────────────────────────────

function initVoiceChat(roomId, userId, isAdmin) {
  VoiceChat.roomId = roomId;
  VoiceChat.userId = userId;
  VoiceChat.isAdmin = isAdmin;

  // Request authoritative voice state from server
  if (posSocket && posSocketConnected) {
    posSocket.emit('voice.get_state', { room_id: roomId });
  }

  // Listen for signaling events
  setupVoiceSignaling();

  // Add voice UI button
  addVoiceUI();
}

// ─── Signaling via Socket.IO ──────────────────────────────────────────────────

function setupVoiceSignaling() {
  if (!posSocket) return;

  posSocket.on('voice_admin_toggle', function(data) {
    VoiceChat.enabled = data.enabled;
    updateVoiceButton();
    if (!VoiceChat.enabled && VoiceChat.active) {
      leaveVoice();
    }
    showVoiceNotification(data.enabled ? '🔊 Voice chat enabled by admin' : '🔇 Voice chat disabled');
  });

  posSocket.on('voice.offer', function(data) {
    if (data.target !== VoiceChat.userId) return;
    handleVoiceOffer(data);
  });

  posSocket.on('voice.answer', function(data) {
    if (data.target !== VoiceChat.userId) return;
    handleVoiceAnswer(data);
  });

  posSocket.on('voice.ice', function(data) {
    if (data.target !== VoiceChat.userId) return;
    handleVoiceICE(data);
  });

  posSocket.on('voice.join', function(data) {
    if (data.userId === VoiceChat.userId) return;
    // New user joined voice — create offer for them
    if (VoiceChat.active && !VoiceChat.muted) {
      createVoiceOffer(data.userId);
    }
  });

  posSocket.on('voice.leave', function(data) {
    removeVoicePeer(data.userId);
  });

  posSocket.on('voice.mute', function(data) {
    // Update peer audio state
    var audioEl = document.getElementById('voice-audio-' + data.userId);
    if (audioEl) {
      audioEl.muted = data.muted;
    }
  });

  posSocket.on('voice.transcript', function(data) {
    if (data.userId === VoiceChat.userId) return;
    showTranscriptBubble(data.userId, data.text);
  });

  posSocket.on('user_left', function(data) {
    removeVoicePeer(data.userId);
  });
}

// ─── RTCPeerConnection ─────────────────────────────────────────────────────────

function getRTCConfig() {
  // ICE servers: STUN + optional TURN
  return {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
      // Add TURN server here for NAT traversal:
      // { urls: 'turn:your-turn-server.com:3478', username: '...', credential: '...' }
    ]
  };
}

async function createVoiceOffer(peerId) {
  if (VoiceChat.peers[peerId]) return;  // already connected

  try {
    var pc = new RTCPeerConnection(getRTCConfig());
    VoiceChat.peers[peerId] = pc;

    // Add local stream
    if (VoiceChat.localStream) {
      VoiceChat.localStream.getTracks().forEach(function(track) {
        pc.addTrack(track, VoiceChat.localStream);
      });
    }

    pc.ontrack = function(event) {
      attachVoiceStream(peerId, event.streams[0]);
    };

    pc.onicecandidate = function(event) {
      if (event.candidate) {
        posSocket.emit('voice.ice', {
          room_id: VoiceChat.roomId,
          from: VoiceChat.userId,
          target: peerId,
          candidate: event.candidate
        });
      }
    };

    var offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    posSocket.emit('voice.offer', {
      room_id: VoiceChat.roomId,
      from: VoiceChat.userId,
      target: peerId,
      sdp: offer.sdp,
      type: offer.type
    });
  } catch (e) {
    console.error('[Voice] Offer failed:', e);
  }
}

async function handleVoiceOffer(data) {
  try {
    var pc = new RTCPeerConnection(getRTCConfig());
    VoiceChat.peers[data.from] = pc;

    // Add local stream
    if (VoiceChat.localStream) {
      VoiceChat.localStream.getTracks().forEach(function(track) {
        pc.addTrack(track, VoiceChat.localStream);
      });
    }

    pc.ontrack = function(event) {
      attachVoiceStream(data.from, event.streams[0]);
    };

    pc.onicecandidate = function(event) {
      if (event.candidate) {
        posSocket.emit('voice.ice', {
          room_id: VoiceChat.roomId,
          from: VoiceChat.userId,
          target: data.from,
          candidate: event.candidate
        });
      }
    };

    await pc.setRemoteDescription(new RTCSessionDescription({ type: data.type, sdp: data.sdp }));
    var answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    posSocket.emit('voice.answer', {
      room_id: VoiceChat.roomId,
      from: VoiceChat.userId,
      target: data.from,
      sdp: answer.sdp,
      type: answer.type
    });
  } catch (e) {
    console.error('[Voice] Handle offer failed:', e);
  }
}

async function handleVoiceAnswer(data) {
  try {
    var pc = VoiceChat.peers[data.from];
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: data.type, sdp: data.sdp }));
    }
  } catch (e) {
    console.error('[Voice] Handle answer failed:', e);
  }
}

async function handleVoiceICE(data) {
  try {
    var pc = VoiceChat.peers[data.from];
    if (pc && data.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  } catch (e) {
    console.error('[Voice] ICE add failed:', e);
  }
}

function attachVoiceStream(peerId, stream) {
  VoiceChat.peerStreams[peerId] = stream;

  // Create audio element for peer
  var audio = document.createElement('audio');
  audio.id = 'voice-audio-' + peerId;
  audio.srcObject = stream;
  audio.autoplay = true;
  audio.style.cssText = 'position:fixed;width:1px;height:1px;top:-9999px;left:-9999px;';
  document.body.appendChild(audio);

  // Show voice indicator for peer
  showVoiceIndicator(peerId, true);
}

function removeVoicePeer(peerId) {
  var pc = VoiceChat.peers[peerId];
  if (pc) {
    pc.close();
    delete VoiceChat.peers[peerId];
  }
  var audio = document.getElementById('voice-audio-' + peerId);
  if (audio) audio.remove();
  delete VoiceChat.peerStreams[peerId];
  showVoiceIndicator(peerId, false);
}

// ─── Join / Leave Voice ───────────────────────────────────────────────────────

async function joinVoice() {
  if (VoiceChat.active || !VoiceChat.enabled) return;

  try {
    // Get microphone
    VoiceChat.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    // Mute initially
    VoiceChat.localStream.getAudioTracks()[0].enabled = false;
    VoiceChat.muted = true;

    VoiceChat.active = true;

    // Set up Whisper transcription
    startWhisperTranscription();

    // Notify room
    posSocket.emit('voice.join', {
      room_id: VoiceChat.roomId,
      userId: VoiceChat.userId
    });

    updateVoiceButton();
    showVoiceNotification('🎙️ Voice active — click to mute');
  } catch (e) {
    console.error('[Voice] Mic access denied:', e);
    showVoiceNotification('❌ Microphone access denied');
  }
}

function leaveVoice() {
  if (!VoiceChat.active) return;

  // Stop Whisper transcription
  stopWhisperTranscription();

  // Stop local stream
  if (VoiceChat.localStream) {
    VoiceChat.localStream.getTracks().forEach(function(t) { t.stop(); });
    VoiceChat.localStream = null;
  }

  // Close all peers
  Object.keys(VoiceChat.peers).forEach(function(peerId) {
    removeVoicePeer(peerId);
  });

  // Notify room
  if (posSocket && posSocketConnected) {
    posSocket.emit('voice.leave', {
      room_id: VoiceChat.roomId,
      userId: VoiceChat.userId
    });
  }

  VoiceChat.active = false;
  VoiceChat.muted = true;
  updateVoiceButton();
}

function toggleMute() {
  if (!VoiceChat.active) return;

  VoiceChat.muted = !VoiceChat.muted;

  if (VoiceChat.localStream) {
    VoiceChat.localStream.getAudioTracks()[0].enabled = !VoiceChat.muted;
  }

  if (posSocket && posSocketConnected) {
    posSocket.emit('voice.mute', {
      room_id: VoiceChat.roomId,
      userId: VoiceChat.userId,
      muted: VoiceChat.muted
    });
  }

  updateVoiceButton();
}

// ─── Admin Toggle ──────────────────────────────────────────────────────────────

function toggleVoiceAdmin() {
  if (!VoiceChat.isAdmin) return;
  // Toggle always goes through server (server is authoritative)
  posSocket.emit('voice.admin_toggle', {
    room_id: VoiceChat.roomId,
    enabled: !VoiceChat.enabled
  });
}

// ─── Whisper Transcription ───────────────────────────────────────────────────

var whisperConfig = null;

async function checkWhisperEnabled() {
  if (whisperConfig !== null) return whisperConfig;
  try {
    var resp = await fetch('/api/whisper-config');
    if (resp.ok) {
      var data = await resp.json();
      whisperConfig = data.enabled;
      return whisperConfig;
    }
  } catch (e) {}
  whisperConfig = false;
  return false;
}

function startWhisperTranscription() {
  if (!VoiceChat.localStream || VoiceChat.transcriber) return;

  // Check if Whisper is enabled on server
  checkWhisperEnabled().then(function(enabled) {
    if (!enabled) return;
    setupMediaRecorder();
  });
}

function setupMediaRecorder() {
  var stream = VoiceChat.localStream;
  if (!stream) return;

  // Use webm/opus if supported, otherwise fallback
  var mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/ogg;codecs=opus';

  var recorder = new MediaRecorder(stream, { mimeType: mimeType, audioBitsPerSecond: 128000 });
  VoiceChat.transcriber = recorder;

  var audioChunks = [];

  recorder.ondataavailable = function(e) {
    if (e.data && e.data.size > 1000) {  // ignore tiny chunks
      audioChunks.push(e.data);
    }
  };

  recorder.onstop = async function() {
    if (audioChunks.length === 0) return;
    var blob = new Blob(audioChunks, { type: mimeType });
    audioChunks = [];

    // Throttle: don't transcribe more than once per 3 seconds
    var now = Date.now();
    if (now - VoiceChat.lastTranscriptTime < 3000) return;
    VoiceChat.lastTranscriptTime = now;

    await sendToWhisper(blob);
  };

  // Request data every 3 seconds
  recorder.start(3000);
}

async function sendToWhisper(blob) {
  try {
    var formData = new FormData();
    formData.append('audio', blob, 'audio.webm');

    var resp = await fetch('/api/transcribe', {
      method: 'POST',
      body: formData
    });

    if (!resp.ok) return;

    var data = await resp.json();
    var text = (data.text || '').trim();
    if (!text) return;

    // Broadcast transcript to all users in room
    if (posSocket && posSocketConnected) {
      posSocket.emit('voice.transcript', {
        room_id: VoiceChat.roomId,
        userId: VoiceChat.userId,
        text: text,
        language: data.language || 'auto'
      });
    }

    // Show own transcript locally
    showTranscriptBubble(VoiceChat.userId, text);
  } catch (e) {
    console.warn('[Whisper] Transcription error:', e);
  }
}

function stopWhisperTranscription() {
  if (VoiceChat.transcriber) {
    VoiceChat.transcriber.stop();
    VoiceChat.transcriber = null;
  }
}

function showTranscriptBubble(peerId, text) {
  var cam = document.getElementById('camera-' + peerId);
  if (!cam) return;

  var bubble = cam.querySelector('.transcript-bubble');
  if (!bubble) {
    bubble = document.createElement('a-text');
    bubble.setAttribute('class', 'transcript-bubble');
    bubble.setAttribute('position', '0 1.0 0');
    bubble.setAttribute('scale', '0.5 0.5 0.5');
    bubble.setAttribute('align', 'center');
    bubble.setAttribute('color', '#FFF');
    bubble.setAttribute('width', '3');
    bubble.setAttribute('wrap-count', '30');
    cam.appendChild(bubble);
  }

  bubble.setAttribute('value', '💬 ' + text);

  setTimeout(function() {
    if (bubble) bubble.setAttribute('value', '');
  }, 5000);
}

// ─── UI ───────────────────────────────────────────────────────────────────────

function addVoiceUI() {
  var container = document.createElement('div');
  container.id = 'voice-ui';
  container.style.cssText =
    'position:fixed;bottom:20px;left:20px;z-index:9999;display:flex;gap:6px;';
  document.body.appendChild(container);

  // Main voice button
  var btn = document.createElement('button');
  btn.id = 'voice-btn';
  btn.onclick = function() {
    if (!VoiceChat.enabled) {
      if (VoiceChat.isAdmin) toggleVoiceAdmin();
      return;
    }
    if (!VoiceChat.active) {
      joinVoice();
    } else {
      toggleMute();
    }
  };
  container.appendChild(btn);

  // Admin toggle button (only for admins)
  if (VoiceChat.isAdmin) {
    var adminBtn = document.createElement('button');
    adminBtn.id = 'voice-admin-btn';
    adminBtn.onclick = toggleVoiceAdmin;
    adminBtn.style.cssText =
      'padding:6px 10px;background:rgba(50,50,50,0.9);color:white;border:none;' +
      'border-radius:6px;cursor:pointer;font-size:12px;';
    container.appendChild(adminBtn);
  }

  // Voice notification toast
  var toast = document.createElement('div');
  toast.id = 'voice-toast';
  toast.style.cssText =
    'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);' +
    'background:rgba(0,0,0,0.85);color:white;padding:8px 16px;border-radius:20px;' +
    'font-size:13px;opacity:0;transition:opacity 0.3s;pointer-events:none;' +
    'font-family:-apple-system,sans-serif;z-index:99999;text-align:center;max-width:90vw;';
  document.body.appendChild(toast);

  updateVoiceButton();
}

function updateVoiceButton() {
  var btn = document.getElementById('voice-btn');
  if (!btn) return;

  if (!VoiceChat.enabled) {
    btn.textContent = '🔇 Voice Off';
    btn.style.cssText =
      'padding:8px 16px;background:rgba(80,80,80,0.9);color:white;border:none;' +
      'border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;';
  } else if (VoiceChat.muted || !VoiceChat.active) {
    btn.textContent = '🎤 Join Voice';
    btn.style.cssText =
      'padding:8px 16px;background:rgba(76,175,80,0.9);color:white;border:none;' +
      'border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;';
  } else {
    btn.textContent = '🎤 Speaking';
    btn.style.cssText =
      'padding:8px 16px;background:#4CAF50;color:white;border:none;' +
      'border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;' +
      'box-shadow:0 0 0 3px rgba(76,175,80,0.4);';
  }

  // Admin button
  var adminBtn = document.getElementById('voice-admin-btn');
  if (adminBtn) {
    adminBtn.textContent = VoiceChat.enabled ? '🔊 ON' : '🔇 OFF';
    adminBtn.style.background = VoiceChat.enabled ? 'rgba(76,175,80,0.9)' : 'rgba(80,80,80,0.9)';
  }
}

function showVoiceNotification(msg, duration) {
  if (duration === undefined) duration = 3000;
  var toast = document.getElementById('voice-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.style.opacity = '1';
  setTimeout(function() { toast.style.opacity = '0'; }, duration);
}

function showVoiceIndicator(peerId, speaking) {
  var cam = document.getElementById('camera-' + peerId);
  if (!cam) return;

  var indicator = cam.querySelector('.voice-indicator');
  if (!indicator && speaking) {
    indicator = document.createElement('a-text');
    indicator.setAttribute('class', 'voice-indicator');
    indicator.setAttribute('value', '🔊');
    indicator.setAttribute('position', '0 0.6 0');
    indicator.setAttribute('scale', '0.8 0.8 0.8');
    indicator.setAttribute('align', 'center');
    cam.appendChild(indicator);
  } else if (indicator && !speaking) {
    indicator.remove();
  }
}

window.initVoiceChat = initVoiceChat;
window.VoiceChat = VoiceChat;
