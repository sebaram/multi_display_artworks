function setStyles(element, styles) {
  element.setAttribute('style', styles);
}

function createLabel(document, text, controlId) {
  const label = document.createElement('label');
  label.textContent = text;
  label.setAttribute('for', controlId);
  setStyles(label, 'display:block;margin-top:12px;margin-bottom:4px;font-size:13px;');
  return label;
}

export function mountProfilePanel({ profile, catalog, onSave, document = globalThis.document }) {
  let currentProfile = { ...profile };
  let previousFocus = null;

  const summary = document.createElement('section');
  summary.setAttribute('aria-label', 'Visitor profile');
  setStyles(summary, [
    'position:fixed',
    'top:12px',
    'left:12px',
    'z-index:9998',
    'display:flex',
    'align-items:center',
    'gap:9px',
    'padding:8px 10px',
    'border-radius:8px',
    'background:rgba(20,20,34,0.9)',
    'color:white',
    'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
    'font-size:13px',
  ].join(';'));

  const swatch = document.createElement('span');
  swatch.setAttribute('aria-hidden', 'true');
  const summaryText = document.createElement('span');
  const editButton = document.createElement('button');
  editButton.textContent = 'Edit';
  editButton.setAttribute('type', 'button');
  setStyles(editButton, 'padding:5px 9px;border:0;border-radius:5px;cursor:pointer;');
  summary.append(swatch, summaryText, editButton);

  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-labelledby', 'profile-dialog-title');
  setStyles(dialog, 'max-width:360px;width:calc(100% - 32px);border:0;border-radius:12px;padding:0;background:#1a1a2e;color:white;font-family:-apple-system,BlinkMacSystemFont,sans-serif;');

  const form = document.createElement('form');
  form.setAttribute('method', 'dialog');
  setStyles(form, 'padding:24px;');
  const title = document.createElement('h2');
  title.setAttribute('id', 'profile-dialog-title');
  title.textContent = 'Visitor profile';
  setStyles(title, 'margin:0 0 8px;font-size:20px;');

  const nameInput = document.createElement('input');
  nameInput.setAttribute('id', 'profile-display-name');
  nameInput.setAttribute('name', 'displayName');
  nameInput.setAttribute('type', 'text');
  nameInput.setAttribute('minlength', '3');
  nameInput.setAttribute('maxlength', '20');
  nameInput.setAttribute('pattern', "[a-zA-Z0-9가-힣\\s\\-_'.]{3,20}");
  nameInput.setAttribute('required', '');
  nameInput.setAttribute('autocomplete', 'nickname');
  setStyles(nameInput, 'box-sizing:border-box;width:100%;padding:9px;');

  const avatarSelect = document.createElement('select');
  avatarSelect.setAttribute('id', 'profile-avatar');
  avatarSelect.setAttribute('name', 'avatarId');
  setStyles(avatarSelect, 'box-sizing:border-box;width:100%;padding:9px;');
  Object.entries(catalog).forEach(([avatarId, avatar]) => {
    const option = document.createElement('option');
    option.setAttribute('value', avatarId);
    option.value = avatarId;
    option.textContent = avatar.label;
    avatarSelect.appendChild(option);
  });

  const colorInput = document.createElement('input');
  colorInput.setAttribute('id', 'profile-color');
  colorInput.setAttribute('name', 'color');
  colorInput.setAttribute('type', 'color');
  setStyles(colorInput, 'width:100%;height:42px;padding:2px;');

  const actions = document.createElement('div');
  setStyles(actions, 'display:flex;justify-content:flex-end;gap:8px;margin-top:20px;');
  const cancelButton = document.createElement('button');
  cancelButton.textContent = 'Cancel';
  cancelButton.setAttribute('type', 'button');
  const saveButton = document.createElement('button');
  saveButton.textContent = 'Save';
  saveButton.setAttribute('type', 'submit');
  setStyles(cancelButton, 'padding:8px 14px;border:0;border-radius:6px;cursor:pointer;');
  setStyles(saveButton, 'padding:8px 14px;border:0;border-radius:6px;background:#4CAF50;color:white;cursor:pointer;');
  actions.append(cancelButton, saveButton);

  form.append(
    title,
    createLabel(document, 'Display name', 'profile-display-name'),
    nameInput,
    createLabel(document, 'Avatar', 'profile-avatar'),
    avatarSelect,
    createLabel(document, 'Color', 'profile-color'),
    colorInput,
    actions,
  );
  dialog.appendChild(form);
  document.body.append(summary, dialog);

  function updateSummary(nextProfile) {
    currentProfile = { ...nextProfile };
    const avatarLabel = catalog[currentProfile.avatarId]?.label ?? catalog.shiba?.label ?? 'Shiba';
    summaryText.textContent = `${currentProfile.displayName} · ${avatarLabel} · ${currentProfile.color}`;
    swatch.setAttribute('style', `display:inline-block;width:18px;height:18px;border-radius:50%;background:${currentProfile.color};border:1px solid white;`);
  }

  function restoreFocus() {
    (previousFocus ?? editButton).focus();
    previousFocus = null;
  }

  function close() {
    if (typeof dialog.close === 'function') dialog.close();
    else {
      dialog.open = false;
      dialog.removeAttribute?.('open');
    }
    restoreFocus();
  }

  function open() {
    previousFocus = document.activeElement && document.activeElement !== document.body
      ? document.activeElement
      : editButton;
    nameInput.value = currentProfile.displayName;
    avatarSelect.value = currentProfile.avatarId;
    colorInput.value = currentProfile.color;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else {
      dialog.open = true;
      dialog.setAttribute('open', '');
    }
    nameInput.focus();
  }

  function saveDraft(event) {
    event?.preventDefault();
    if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;
    const draft = {
      displayName: nameInput.value,
      avatarId: avatarSelect.value,
      color: colorInput.value,
    };
    updateSummary(onSave(draft) ?? draft);
    close();
  }

  editButton.addEventListener('click', open);
  cancelButton.addEventListener('click', close);
  saveButton.addEventListener('click', saveDraft);
  form.addEventListener('submit', saveDraft);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close();
  });

  updateSummary(currentProfile);

  return {
    open,
    destroy() {
      summary.remove();
      dialog.remove();
    },
  };
}
