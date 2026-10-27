let dialogSequence = 0;

// Native HTML dialogs work in browsers that suppress window.prompt/confirm.
export async function ask({ title = '请确认', message = '', defaultValue } = {}) {
  const textMode = defaultValue !== undefined;
  const cancelled = textMode ? null : false;
  return new Promise((resolve, reject) => {
    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    const form = document.createElement('form');
    form.className = 'dialog-form';
    const heading = document.createElement('h2');
    heading.id = `quant-ask-${++dialogSequence}`;
    heading.textContent = title;
    dialog.setAttribute('aria-labelledby', heading.id);
    form.append(heading);
    if (message) {
      const description = document.createElement('p');
      description.id = `${heading.id}-message`;
      description.textContent = message;
      dialog.setAttribute('aria-describedby', description.id);
      form.append(description);
    }
    let input;
    if (textMode) {
      const label = document.createElement('label');
      label.textContent = '名称';
      input = document.createElement('input');
      input.type = 'text';
      input.value = String(defaultValue ?? '');
      input.autocomplete = 'off';
      label.append(input);
      form.append(label);
    }
    const actions = document.createElement('div');
    actions.className = 'action-row';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'button secondary';
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'submit';
    confirm.className = 'button primary';
    confirm.textContent = '确认';
    actions.append(cancel, confirm);
    form.append(actions);
    dialog.append(form);
    let finished = false;
    function finish(value) {
      if (finished) return;
      finished = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      if (previousFocus?.isConnected) previousFocus.focus?.();
      resolve(value);
    }
    form.addEventListener('submit', event => {
      event.preventDefault();
      finish(textMode ? input.value : true);
    });
    cancel.addEventListener('click', () => finish(cancelled));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(cancelled); });
    dialog.addEventListener('close', () => finish(cancelled));
    document.body.append(dialog);
    try {
      dialog.showModal();
      (input || confirm).focus();
      input?.select();
    } catch (error) {
      dialog.remove();
      reject(error);
    }
  });
}
