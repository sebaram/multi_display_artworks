/**
 * room-effects.js — renders LLM-triggered visual/audio effects in A-Frame
 * Listens to Socket.IO events: room_effects, room_effects_cleared
 * Reads active effects from RoomEffect DB and applies to scene
 */
(function() {
  var effects = {};
  var activeParticles = [];
  var activeSpotlights = {};
  var activeAmbient = null;

  window.RoomEffects = {
    init: function(roomId) {
      this.roomId = roomId;
      setupSocketListeners();
      // Fetch current active effects from server
      fetchActiveEffects();
    }
  };

  function setupSocketListeners() {
    if (!posSocket) return;

    posSocket.on('room_effects', function(data) {
      if (data.room_id !== RoomEffects.roomId) return;
      renderEffects(data.effects);
    });

    posSocket.on('room_effects_cleared', function(data) {
      if (data.room_id !== RoomEffects.roomId) return;
      clearAllEffects();
    });
  }

  function fetchActiveEffects() {
    // Server pushes active effects on join via room_state
    // This is called on init; actual sync happens through socket events
  }

  function renderEffects(effectList) {
    clearAllEffects();

    if (!effectList || !Array.isArray(effectList)) return;

    effectList.forEach(function(fx) {
      switch (fx.effect_type) {
        case 'glitter': renderGlitter(fx.params); break;
        case 'spotlight': renderSpotlight(fx.target_id, fx.params); break;
        case 'ambient': renderAmbient(fx.params); break;
        case 'fog': renderFog(fx.params); break;
        case 'sound': playSound(fx.params); break;
        case 'pulse': renderPulse(fx.target_id, fx.params); break;
        case 'color_shift': renderColorShift(fx.params); break;
        case 'shake': renderShake(fx.params); break;
        case 'fade': renderFade(fx.params); break;
      }
    });
  }

  // ─── Glitter ───────────────────────────────────────────────────────────────
  function renderGlitter(params) {
    var density = (params && params.density) ? parseInt(params.density) : 30;
    var color = (params && params.color) || '#FFD700';
    var duration = (params && params.duration) ? parseInt(params.duration) : 5000;

    var scene = document.querySelector('a-scene');
    if (!scene) return;

    // Create sparkle entities
    for (var i = 0; i < density; i++) {
      var sparkle = document.createElement('a-entity');
      var x = (Math.random() - 0.5) * 12;
      var y = Math.random() * 4;
      var z = (Math.random() - 0.5) * 12;
      var size = 0.02 + Math.random() * 0.03;

      sparkle.setAttribute('geometry', 'primitive: sphere; radius: ' + size);
      sparkle.setAttribute('material', 'color: ' + color + '; emissive: ' + color + '; emissiveIntensity: 1; shader: flat');
      sparkle.setAttribute('position', x + ' ' + y + ' ' + z);
      sparkle.setAttribute('animation', {
        property: 'position',
        to: (Math.random() - 0.5) * 12 + ' ' + (y + 2 + Math.random() * 2) + ' ' + (Math.random() - 0.5) * 12,
        dur: 2000 + Math.random() * 2000,
        easing: 'easeInOutSine',
        loop: true,
        dir: 'alternate'
      });
      scene.appendChild(sparkle);
      activeParticles.push(sparkle);
    }

    // Auto-expire
    setTimeout(function() {
      activeParticles.forEach(function(p) { if (p.parentNode) p.parentNode.removeChild(p); });
      activeParticles = [];
    }, duration * 1000);
  }

  // ─── Spotlight ────────────────────────────────────────────────────────────
  function renderSpotlight(targetId, params) {
    var intensity = (params && params.intensity) ? parseFloat(params.intensity) : 0.8;
    var color = (params && params.color) || '#FFFFFF';
    var targetEl = null;

    if (targetId) {
      targetEl = document.querySelector('[data-element-id="' + targetId + '"]') ||
                 document.getElementById(targetId);
    }

    var scene = document.querySelector('a-scene');
    if (!scene) return;

    // Remove existing spotlight
    var existingSpot = document.getElementById('llm-spotlight');
    if (existingSpot) existingSpot.parentNode.removeChild(existingSpot);

    var spot = document.createElement('a-entity');
    spot.setAttribute('id', 'llm-spotlight');
    spot.setAttribute('light', 'type: spot; color: ' + color + '; intensity: ' + intensity + '; angle: 35; penumbra: 0.3; decay: 1.5');

    if (targetEl) {
      var pos = targetEl.getAttribute('position');
      spot.setAttribute('position', pos);
    } else {
      // Room center spotlight
      spot.setAttribute('position', '0 4 0');
    }

    scene.appendChild(spot);
    activeSpotlights['spotlight'] = spot;
  }

  // ─── Ambient ──────────────────────────────────────────────────────────────
  function renderAmbient(params) {
    var type = (params && params.type) || 'warm';
    var intensity = (params && params.intensity) ? parseFloat(params.intensity) : 0.5;

    var scene = document.querySelector('a-scene');
    if (!scene) return;

    var existingAmbient = document.getElementById('llm-ambient-light');
    if (existingAmbient) existingAmbient.parentNode.removeChild(existingAmbient);

    var configs = {
      warm: { color: '#FFDD99', intensity: intensity },
      cool: { color: '#99CCFF', intensity: intensity },
      dramatic: { color: '#FF8844', intensity: intensity * 1.5 },
      subtle: { color: '#CCCCCC', intensity: intensity * 0.5 }
    };
    var cfg = configs[type] || configs.warm;

    var light = document.createElement('a-entity');
    light.setAttribute('id', 'llm-ambient-light');
    light.setAttribute('position', '0 4 0');
    light.setAttribute('light', 'type: point; color: ' + cfg.color + '; intensity: ' + cfg.intensity + '; distance: 20; decay: 1');

    scene.appendChild(light);
    activeAmbient = light;
  }

  // ─── Fog ─────────────────────────────────────────────────────────────────
  function renderFog(params) {
    var density = (params && params.density !== undefined) ? parseFloat(params.density) : 0.3;
    var color = (params && params.color) || '#888888';
    var scene = document.querySelector('a-scene');
    if (scene) {
      scene.setAttribute('fog', 'type: exponential; color: ' + color + '; density: ' + density);
    }
  }

  // ─── Sound ────────────────────────────────────────────────────────────────
  function playSound(params) {
    var url = params && params.url;
    if (!url) return;

    var volume = (params && params.volume !== undefined) ? parseFloat(params.volume) : 0.5;
    var loop = params && params.loop;

    var existing = document.getElementById('llm-ambient-audio');
    if (existing) { existing.parentNode.removeChild(existing); }

    var audio = document.createElement('audio');
    audio.id = 'llm-ambient-audio';
    audio.src = url;
    audio.volume = volume;
    audio.loop = loop ? true : false;
    audio.autoplay = true;
    document.body.appendChild(audio);
  }

  // ─── Pulse ────────────────────────────────────────────────────────────────
  function renderPulse(targetId, params) {
    var color = (params && params.color) || '#FFFF00';
    var speed = (params && params.speed) || 'medium';
    var durations = { slow: 2000, medium: 1000, fast: 400 };
    var dur = durations[speed] || 1000;

    var targetEl = null;
    if (targetId) {
      targetEl = document.querySelector('[data-element-id="' + targetId + '"]') ||
                 document.getElementById(targetId);
    }
    if (!targetEl) return;

    var pulse = document.createElement('a-entity');
    pulse.setAttribute('id', 'llm-pulse-' + targetId);
    pulse.setAttribute('geometry', 'primitive: plane; width: 0.1; height: 0.1');
    pulse.setAttribute('material', 'color: ' + color + '; shader: flat; opacity: 0.3; transparent: true');
    pulse.setAttribute('position', targetEl.getAttribute('position') || '0 0 0');
    pulse.setAttribute('animation', {
      property: 'scale',
      from: '1 1 1',
      to: '8 8 8',
      dur: dur,
      easing: 'easeOutQuad',
      loop: true,
      dir: 'alternate'
    });
    pulse.setAttribute('animation__fade', {
      property: 'material.opacity',
      from: 0.4,
      to: 0,
      dur: dur,
      easing: 'easeOutQuad',
      loop: true,
      dir: 'alternate'
    });

    var scene = document.querySelector('a-scene');
    if (scene) scene.appendChild(pulse);
  }

  // ─── Color Shift ─────────────────────────────────────────────────────────
  function renderColorShift(params) {
    var color = (params && params.color) || '#8866AA';
    var intensity = (params && params.intensity) ? parseFloat(params.intensity) : 0.3;
    var scene = document.querySelector('a-scene');
    if (scene) {
      scene.setAttribute('light', 'color: ' + color + '; intensity: ' + intensity);
    }
  }

  // ─── Shake ──────────────────────────────────────────────────────────────
  function renderShake(params) {
    var intensity = (params && params.intensity) ? parseFloat(params.intensity) : 0.5;
    var duration = (params && params.duration) ? parseInt(params.duration) : 2000;
    var camera = document.getElementById('camera-rig') || document.querySelector('[camera]');
    if (!camera) return;

    var originalPos = camera.getAttribute('position');
    var startTime = Date.now();

    function shake() {
      var elapsed = Date.now() - startTime;
      if (elapsed > duration * 1000) {
        camera.setAttribute('position', originalPos);
        return;
      }
      var decay = 1 - (elapsed / (duration * 1000));
      var dx = (Math.random() - 0.5) * intensity * 0.1 * decay;
      var dy = (Math.random() - 0.5) * intensity * 0.1 * decay;
      camera.setAttribute('position', {
        x: parseFloat(originalPos.x) + dx,
        y: parseFloat(originalPos.y) + dy,
        z: parseFloat(originalPos.z)
      });
      requestAnimationFrame(shake);
    }
    shake();
  }

  // ─── Fade ────────────────────────────────────────────────────────────────
  function renderFade(params) {
    var type = (params && params.type) || 'in';
    var duration = (params && params.duration) ? parseInt(params.duration) : 2000;
    var overlay = document.getElementById('llm-fade-overlay');
    if (!overlay) {
      overlay = document.createElement('a-entity');
      overlay.id = 'llm-fade-overlay';
      overlay.setAttribute('geometry', 'primitive: plane; width: 100; height: 100');
      overlay.setAttribute('material', 'color: #000000; shader: flat; transparent: true; opacity: 0; side: back');
      overlay.setAttribute('position', '0 0 -0.5');
      overlay.setAttribute('look-at', '[camera]');
      var scene = document.querySelector('a-scene');
      if (scene) scene.appendChild(overlay);
    }

    var fromOpacity = type === 'in' ? 1 : 0;
    var toOpacity = type === 'in' ? 0 : 1;
    overlay.setAttribute('animation', {
      property: 'material.opacity',
      from: fromOpacity,
      to: toOpacity,
      dur: duration,
      easing: 'easeInOutQuad'
    });
  }

  // ─── Clear All ───────────────────────────────────────────────────────────
  function clearAllEffects() {
    // Particles
    activeParticles.forEach(function(p) { if (p.parentNode) p.parentNode.removeChild(p); });
    activeParticles = [];

    // Spotlight
    var spot = document.getElementById('llm-spotlight');
    if (spot && spot.parentNode) spot.parentNode.removeChild(spot);

    // Ambient
    var amb = document.getElementById('llm-ambient-light');
    if (amb && amb.parentNode) amb.parentNode.removeChild(amb);

    // Fog
    var scene = document.querySelector('a-scene');
    if (scene) scene.setAttribute('fog', '');

    // Audio
    var audio = document.getElementById('llm-ambient-audio');
    if (audio) { audio.pause(); audio.parentNode.removeChild(audio); }

    // Pulses
    document.querySelectorAll('[id^="llm-pulse-"]').forEach(function(el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });

    // Fade overlay
    var overlay = document.getElementById('llm-fade-overlay');
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }
})();