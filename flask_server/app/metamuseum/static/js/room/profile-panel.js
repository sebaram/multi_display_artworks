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

function createButton(document, text) {
  const button = document.createElement('button');
  button.textContent = text;
  button.setAttribute('type', 'button');
  setStyles(button, 'padding:5px 9px;border:0;border-radius:5px;cursor:pointer;');
  return button;
}

export function mountProfilePanel({
  profile,
  catalog,
  onSave,
  onNewVisitor = () => {},
  document,
}) {
  let currentProfile = { ...profile };
  let dialog = null;
  let editor = null;

  const container = document.createElement('div');
  setStyles(container, 'pointer-events:auto;');

  const visitorButton = createButton(document, 'Visitor');
  visitorButton.setAttribute('aria-controls', 'visitor-profile-summary');
  visitorButton.setAttribute('aria-expanded', 'false');
  container.appendChild(visitorButton);

  const summary = document.createElement('section');
  summary.setAttribute('id', 'visitor-profile-summary');
  summary.setAttribute('aria-label', 'Visitor profile');
  setStyles(summary, [
    'display:flex',
    'align-items:center',
    'gap:9px',
    'margin-top:6px',
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
  summaryText.setAttribute('aria-live', 'polite');
  const editButton = createButton(document, 'Edit');
  const newVisitorButton = createButton(document, 'New visitor');
  const errorMessage = document.createElement('p');
  errorMessage.setAttribute('role', 'alert');
  setStyles(errorMessage, 'margin:8px 0 0;color:#ffb4ab;');
  const retryButton = createButton(document, 'Retry');
  summary.append(swatch, summaryText, editButton, newVisitorButton);

  function updateProfile(nextProfile) {
    currentProfile = { ...nextProfile };
    const avatarLabel = catalog[currentProfile.avatarId]?.label ?? catalog.shiba?.label ?? 'Shiba';
    summaryText.textContent = `${currentProfile.displayName} · ${avatarLabel} · ${currentProfile.color}`;
    swatch.setAttribute('style', `display:inline-block;width:18px;height:18px;border-radius:50%;background:${currentProfile.color};border:1px solid white;`);
  }

  function open() {
    if (!summary.parentNode) container.appendChild(summary);
    visitorButton.setAttribute('aria-expanded', 'true');
  }

  function showConnectionError(
    message = 'Visitor connection expired or was rejected. Retry to create a new visitor.',
  ) {
    open();
    errorMessage.textContent = message;
    if (!errorMessage.parentNode) summary.append(errorMessage, retryButton);
  }

  function clearConnectionError() {
    errorMessage.remove();
    retryButton.remove();
  }

  function restoreFocus() {
    editButton.focus();
  }

  function closeEditor() {
    if (typeof dialog.close === 'function') dialog.close();
    else {
      dialog.open = false;
      dialog.removeAttribute?.('open');
    }
    restoreFocus();
  }

  function createEditor() {
    dialog = document.createElement('dialog');
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
    const cancelButton = createButton(document, 'Cancel');
    const saveButton = createButton(document, 'Save');
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
    document.body.appendChild(dialog);

    function saveDraft(event) {
      event?.preventDefault();
      if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;
      const draft = {
        displayName: nameInput.value,
        avatarId: avatarSelect.value,
        color: colorInput.value,
      };
      updateProfile(onSave(draft) ?? draft);
      closeEditor();
    }

    cancelButton.addEventListener('click', closeEditor);
    form.addEventListener('submit', saveDraft);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeEditor();
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeEditor();
    });

    return { nameInput, avatarSelect, colorInput };
  }

  function openEditor() {
    if (!editor) editor = createEditor();
    editor.nameInput.value = currentProfile.displayName;
    editor.avatarSelect.value = currentProfile.avatarId;
    editor.colorInput.value = currentProfile.color;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else {
      dialog.open = true;
      dialog.setAttribute('open', '');
    }
    editor.nameInput.focus();
  }

  async function replaceVisitor(failureMessage) {
    newVisitorButton.disabled = true;
    retryButton.disabled = true;
    try {
      const nextSession = await onNewVisitor();
      clearConnectionError();
      if (nextSession?.profile) updateProfile(nextSession.profile);
    } catch {
      showConnectionError(failureMessage);
    } finally {
      newVisitorButton.disabled = false;
      retryButton.disabled = false;
    }
  }

  visitorButton.addEventListener('click', open);
  editButton.addEventListener('click', openEditor);
  newVisitorButton.addEventListener('click', () => {
    void replaceVisitor('Unable to create a new visitor. Retry when ready.');
  });
  retryButton.addEventListener('click', () => {
    void replaceVisitor('Unable to retry the visitor connection. Try again when ready.');
  });

  updateProfile(currentProfile);
  const toolbar = document.getElementById?.('room-toolbar') ?? document.body;
  toolbar.appendChild(container);

  return {
    open,
    clearConnectionError,
    showConnectionError,
    updateProfile,
    destroy() {
      container.remove();
      dialog?.remove();
    },
  };
}
