class ModalManager {
  constructor() {
    this.dialog = document.getElementById('app-modal');
    if (!this.dialog) {
      this.dialog = document.createElement('dialog');
      this.dialog.id = 'app-modal';
      this.dialog.className = 'app-modal';
      document.body.appendChild(this.dialog);
    }

    this._cleanupFn = null;
    this._onClose = null;
    this._finishClose = null; // definido enquanto o modal está fechando
    this.closable = true;
    this._bindGlobalEvents();
  }

  _bindGlobalEvents() {
    // Fechar ao clicar fora (no backdrop)
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog && this.closable) this.close();
    });

    // ESC
    this.dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      if (this.closable) this.close();
    });
  }

  // Executa (uma única vez) o cleanup do onMount e o onClose
  _runCallbacks() {
    const cleanup = this._cleanupFn;
    const onClose = this._onClose;
    this._cleanupFn = null;
    this._onClose = null;

    if (typeof cleanup === 'function') cleanup();
    if (typeof onClose === 'function') onClose();
  }

  /**
   * @param {Object} options
   * @param {string} options.title
   * @param {string|HTMLElement} options.html - Conteúdo do corpo
   * @param {string} [options.size='md'] - 'sm' | 'md' | 'lg'
   * @param {boolean} [options.closable=true] - Permite fechar no X, ESC ou backdrop
   * @param {Function} [options.onMount] - (body, manager) => cleanup opcional
   * @param {Function} [options.onClose] - Executado depois que o modal fechou
   */
  open(options) {
    const {
      title = '',
      html = '',
      size = 'md',
      closable = true,
      onMount = null,
      onClose = null,
    } = options;

    // Se estava fechando, termina agora. Se estava aberto, substitui
    // (chamando o onClose do anterior para não deixar Promises pendentes).
    if (this._finishClose) {
      this._finishClose();
    } else if (this.dialog.open) {
      this._runCallbacks();
    }

    this._onClose = onClose;
    this.closable = closable;

    this.dialog.dataset.size = size;
    this.dialog.classList.remove('closing');

    this.dialog.innerHTML = `
      <div class="app-modal-box">
        <div class="app-modal-header">
          <h3 class="app-modal-title">${title}</h3>
          ${closable ? '<button type="button" class="app-modal-close" aria-label="Fechar">&times;</button>' : ''}
        </div>
        <div class="app-modal-body"></div>
      </div>
    `;

    const bodyEl = this.dialog.querySelector('.app-modal-body');

    if (typeof html === 'string') {
      bodyEl.innerHTML = html;
    } else if (html instanceof HTMLElement) {
      bodyEl.appendChild(html);
    }

    const closeBtn = this.dialog.querySelector('.app-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());

    if (!this.dialog.open) this.dialog.showModal();

    requestAnimationFrame(() => this.dialog.classList.add('open'));

    if (typeof onMount === 'function') {
      const cleanup = onMount(bodyEl, this);
      if (typeof cleanup === 'function') this._cleanupFn = cleanup;
    }
  }

  close() {
    if (!this.dialog.open || this._finishClose) return;

    this.dialog.classList.remove('open');
    this.dialog.classList.add('closing');

    // ignora transitionend vindo de elementos internos (hover de botões etc.)
    const onEnd = (e) => {
      if (e.target === this.dialog) this._finishClose?.();
    };
    const timer = setTimeout(() => this._finishClose?.(), 300); // fallback

    this._finishClose = () => {
      clearTimeout(timer);
      this.dialog.removeEventListener('transitionend', onEnd);
      this._finishClose = null;

      this.dialog.close();
      this.dialog.classList.remove('closing');
      this.dialog.innerHTML = '';

      this._runCallbacks();
    };

    this.dialog.addEventListener('transitionend', onEnd);
  }

  /**
   * Modal de confirmação. Resolve true se confirmou;
   * false se cancelou, clicou fora, apertou ESC ou o X.
   */
  confirm({
    title = 'Confirmar',
    message = '',
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    size = 'sm',
  } = {}) {
    return new Promise((resolve) => {
      let result = false;

      this.open({
        title,
        size,
        html: `
          ${message ? `<p class="modal-text">${message}</p>` : ''}
          <div class="modal-actions">
            <button type="button" class="modal-button" data-action="cancel">${cancelText}</button>
            <button type="button" class="modal-button modal-button-main" data-action="confirm">${confirmText}</button>
          </div>
        `,
        onMount: (body, manager) => {
          const cancelBtn = body.querySelector('[data-action="cancel"]');
          const confirmBtn = body.querySelector('[data-action="confirm"]');

          cancelBtn.addEventListener('click', () => manager.close());
          confirmBtn.addEventListener('click', () => {
            result = true;
            manager.close();
          });

          cancelBtn.focus();
        },
        onClose: () => resolve(result),
      });
    });
  }
}

export const modal = new ModalManager();