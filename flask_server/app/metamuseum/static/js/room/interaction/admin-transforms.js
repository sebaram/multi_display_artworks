const TRANSFORM_PANEL = `
  <div style="background:rgba(0,0,0,0.92);color:white;padding:15px;border-radius:8px;font-size:12px;width:280px;">
    <div style="font-weight:bold;margin-bottom:10px;">✏️ Transform Controls</div>
    <div style="margin-bottom:6px;"><label>Position X: <span id="tf-pos-x-val">0.00</span></label><br>
    <input type="range" id="tf-pos-x" min="-5" max="5" step="0.01" value="0" style="width:100%"></div>
    <div style="margin-bottom:6px;"><label>Position Y: <span id="tf-pos-y-val">0.00</span></label><br>
    <input type="range" id="tf-pos-y" min="-5" max="5" step="0.01" value="0" style="width:100%"></div>
    <div style="margin-bottom:6px;"><label>Scale X: <span id="tf-scale-x-val">1.00</span></label><br>
    <input type="range" id="tf-scale-x" min="0.1" max="5" step="0.01" value="1" style="width:100%"></div>
    <div style="margin-bottom:6px;"><label>Scale Y: <span id="tf-scale-y-val">1.00</span></label><br>
    <input type="range" id="tf-scale-y" min="0.1" max="5" step="0.01" value="1" style="width:100%"></div>
    <div style="margin-bottom:6px;"><label>Scale Z: <span id="tf-scale-z-val">1.00</span></label><br>
    <input type="range" id="tf-scale-z" min="0.1" max="5" step="0.01" value="1" style="width:100%"></div>
    <div style="margin-bottom:6px;"><label>Rotate X: <span id="tf-rot-x-val">0°</span></label><br>
    <input type="range" id="tf-rot-x" min="-180" max="180" step="1" value="0" style="width:100%"></div>
    <div style="margin-bottom:6px;"><label>Rotate Y: <span id="tf-rot-y-val">0°</span></label><br>
    <input type="range" id="tf-rot-y" min="-180" max="180" step="1" value="0" style="width:100%"></div>
    <div style="margin-bottom:6px;"><label>Rotate Z: <span id="tf-rot-z-val">0°</span></label><br>
    <input type="range" id="tf-rot-z" min="-180" max="180" step="1" value="0" style="width:100%"></div>
    <div style="display:flex;gap:8px;margin-top:10px;">
      <button id="tf-reset" style="flex:1;padding:6px;background:#666;color:white;border:none;border-radius:4px;cursor:pointer;">Reset</button>
      <button id="tf-apply" style="flex:1;padding:6px;background:#4CAF50;color:white;border:none;border-radius:4px;cursor:pointer;">Apply</button>
    </div>
    <div id="tf-status" style="text-align:center;margin-top:6px;font-size:11px;height:16px;"></div>
  </div>`;

function value(document, id) {
  return parseFloat(document.getElementById(id).value);
}

function initializeTransformControls({ document, fetch, setTimeout }) {
  const panel = document.getElementById('transform-panel');
  const element = document.querySelector('[data-element-id]');
  if (!panel || !element) return;

  const position = element.getAttribute('position') || {};
  const scale = element.getAttribute('scale') || {};
  const rotation = element.getAttribute('rotation') || {};
  const elementId = element.getAttribute('data-element-id');
  const elementType = element.getAttribute('data-element-type');
  const setValue = (id, nextValue) => {
    const input = document.getElementById(id);
    if (input) input.value = parseFloat(nextValue || 0).toFixed(2);
  };

  setValue('tf-pos-x', position.x);
  setValue('tf-pos-y', position.y);
  setValue('tf-scale-x', scale.x || 1);
  setValue('tf-scale-y', scale.y || 1);
  setValue('tf-scale-z', scale.z || 1);
  setValue('tf-rot-x', rotation.x || 0);
  setValue('tf-rot-y', rotation.y || 0);
  setValue('tf-rot-z', rotation.z || 0);

  panel.querySelectorAll('input[type="range"]').forEach((slider) => {
    slider.addEventListener('input', () => {
      const nextValue = parseFloat(slider.value);
      if (slider.id.startsWith('tf-scale')) {
        element.setAttribute('scale', `${value(document, 'tf-scale-x')} ${value(document, 'tf-scale-y')} ${value(document, 'tf-scale-z')}`);
      } else if (slider.id.startsWith('tf-rot')) {
        element.setAttribute('rotation', `${value(document, 'tf-rot-x')} ${value(document, 'tf-rot-y')} ${value(document, 'tf-rot-z')}`);
      } else if (slider.id.startsWith('tf-pos')) {
        element.setAttribute('position', `${value(document, 'tf-pos-x')} ${value(document, 'tf-pos-y')} ${parseFloat(position.z || 0.2)}`);
      }
      const display = document.getElementById(`${slider.id}-val`);
      if (display) display.textContent = nextValue.toFixed(2);
    });
  });

  document.getElementById('tf-apply')?.addEventListener('click', async () => {
    const body = {
      position_x: value(document, 'tf-pos-x'),
      position_y: value(document, 'tf-pos-y'),
      scale_x: value(document, 'tf-scale-x'),
      scale_y: value(document, 'tf-scale-y'),
      scale_z: value(document, 'tf-scale-z'),
      rotation_x: value(document, 'tf-rot-x'),
      rotation_y: value(document, 'tf-rot-y'),
      rotation_z: value(document, 'tf-rot-z'),
    };
    const status = document.getElementById('tf-status');
    try {
      const response = await fetch(`/element/${elementId}/${elementType}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (status) {
        status.textContent = data.status === 'success' ? '✅ Saved!' : '❌ Error';
        status.style.color = data.status === 'success' ? '#4CAF50' : '#ff6b6b';
        setTimeout(() => { status.textContent = ''; }, 2000);
      }
    } catch {
      if (status) {
        status.textContent = '❌ Network error';
        status.style.color = '#ff6b6b';
      }
    }
  });

  document.getElementById('tf-reset')?.addEventListener('click', () => {
    ['tf-pos-x', 'tf-pos-y', 'tf-scale-x', 'tf-scale-y', 'tf-scale-z', 'tf-rot-x', 'tf-rot-y', 'tf-rot-z']
      .forEach((id) => {
        const isScale = id.includes('scale');
        const input = document.getElementById(id);
        if (input) input.value = isScale ? '1' : '0';
        const display = document.getElementById(`${id}-val`);
        if (display) display.textContent = isScale ? '1.00' : '0.00';
      });
    element.setAttribute('position', `${position.x || 0} ${position.y || 0} ${position.z || 0.2}`);
    element.setAttribute('scale', '1 1 1');
    element.setAttribute('rotation', '0 0 0');
  });
}

async function enableARPassthrough({ document, navigator, alert }) {
  if (!navigator.xr) {
    alert('WebXR not supported on this device');
    return;
  }
  try {
    if (!await navigator.xr.isSessionSupported('immersive-ar')) {
      alert('AR passthrough not supported on this device');
      return;
    }
    const scene = document.querySelector('a-scene');
    if (!scene) return;
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['dom-overlay', 'hand-tracking'],
      optionalFeatures: ['local-floor', 'bounded-floor', 'passthrough'],
    });
    const button = document.getElementById('ar-passthrough-btn');
    session.addEventListener('end', () => {
      if (!button) return;
      button.textContent = '🥽 Enable AR Passthrough';
      button.style.background = 'rgba(33,150,243,0.9)';
    });
    scene.setAttribute('renderer', 'colorManagement: true; physicallyCorrectLights: true; logarithmicDepthBuffer: true');
    scene.setAttribute('vr-mode-ui', 'enabled: true');
    scene.setAttribute('ar', 'touchEnabled: true; hitTestEnabled: true');
    await scene.setSession(session);
    if (button) {
      button.textContent = '✅ AR Passthrough Active';
      button.style.background = '#4CAF50';
    }
  } catch (error) {
    alert(`Failed to start AR: ${error.message}`);
  }
}

function addAdminUi(dependencies) {
  const { document, setTimeout } = dependencies;
  if (document.getElementById('admin-indicator')) return;

  const indicator = document.createElement('button');
  indicator.id = 'admin-indicator';
  indicator.textContent = '✋ Transform (Admin)';
  indicator.style.cssText = 'position:fixed;top:10px;right:10px;background:rgba(76,175,80,0.9);color:white;padding:6px 12px;border:0;border-radius:4px;font-size:12px;z-index:9999;cursor:pointer;';

  const arButton = document.createElement('button');
  arButton.id = 'ar-passthrough-btn';
  arButton.textContent = '🥽 AR Passthrough';
  arButton.style.cssText = 'position:fixed;top:10px;right:190px;padding:6px 12px;background:rgba(33,150,243,0.9);color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px;z-index:9999;';
  arButton.addEventListener('click', () => enableARPassthrough(dependencies));

  const panel = document.createElement('div');
  panel.id = 'transform-panel';
  panel.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:9997;display:none;';
  panel.style.display = 'none';
  panel.innerHTML = TRANSFORM_PANEL;
  indicator.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  document.body.appendChild(indicator);
  document.body.appendChild(arButton);
  document.body.appendChild(panel);
  setTimeout(() => initializeTransformControls(dependencies), 1500);
}

export function mountAdminTransforms(dependencies) {
  const { document, setTimeout } = dependencies;
  const enable = () => {
    document.querySelectorAll('[data-element-id]').forEach((element) => {
      const elementId = element.getAttribute('data-element-id');
      const elementType = element.getAttribute('data-element-type');
      if (!elementId || !elementType) return;
      element.setAttribute('drag-element', `elementId: ${elementId}, elementType: ${elementType}`);
      element.setAttribute('class', 'clickable');
    });
    addAdminUi(dependencies);
  };
  const scene = document.querySelector('a-scene');
  const onSceneLoaded = () => setTimeout(enable, 500);
  scene?.addEventListener('loaded', onSceneLoaded);
  setTimeout(enable, 1000);

  return {
    destroy() {
      scene?.removeEventListener('loaded', onSceneLoaded);
      document.getElementById('admin-indicator')?.remove();
      document.getElementById('ar-passthrough-btn')?.remove();
      document.getElementById('transform-panel')?.remove();
    },
  };
}
