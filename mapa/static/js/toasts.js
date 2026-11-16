const CATEGORIES = {
    warn:    { icon: 'fa-triangle-exclamation', role: 'alert' },
    error:   { icon: 'fa-circle-xmark',         role: 'alert' },
    success: { icon: 'fa-circle-check',         role: 'status' },
    none:    { icon: null,                      role: 'status' },
};

class ToastManager {
    constructor() {
        this.container = document.getElementById('toast-container');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'toast-container';
            document.body.appendChild(this.container);
        }
    }

    /**
     * @param {Object} options
     * @param {'warn'|'error'|'success'|'none'} [options.category='none'] - colors + icon
     * @param {string} [options.title]    - bold first line (plain text, safe for user data)
     * @param {string} [options.text]     - message (plain text, safe for user data)
     * @param {string} [options.html]     - extra content under the message, e.g. action buttons
     *                                      (raw HTML: escape anything that comes from the user)
     * @param {number} [options.duration=5000] - 0 = stays until removed
     * @param {number} [options.priority=1]
     * @param {string} [options.className]     - extra class for one-off tweaks
     */
    show(options) {
        const {
            text = '',
            title = '',
            html = null,
            category = 'none',
            duration = 5000,
            priority = 1,
            className = '',
        } = options;

        const kind = Object.hasOwn(CATEGORIES, category) ? category : 'none';

        const toast = document.createElement('div');
        toast.className = `toast ${className}`.trim();   // .toast is always there: CSS is scoped to it
        toast.dataset.category = kind;
        toast.dataset.priority = priority;
        toast.setAttribute('role', CATEGORIES[kind].role);

        this._build(toast, { kind, title, text, html });

        const existingToasts = Array.from(this.container.children);
        const insertBeforeTarget = existingToasts.find(
            t => parseInt(t.dataset.priority) < priority
        );

        if (insertBeforeTarget) {
            this.container.insertBefore(toast, insertBeforeTarget);
        } else {
            this.container.appendChild(toast);
        }
        requestAnimationFrame(() => {
            toast.classList.add('visible');
        });

        if (duration > 0) {
            setTimeout(() => this.remove(toast), duration);
        }

        return toast;
    }

    _build(toast, { kind, title, text, html }) {
        // plain toast: same as before (just text, or raw html)
        if (kind === 'none' && !title) {
            if (html) toast.innerHTML = html;
            else toast.innerText = text;
            return;
        }

        const head = document.createElement('div');
        head.className = 'toast-head';

        const { icon } = CATEGORIES[kind];
        if (icon) {
            const iconEl = document.createElement('span');
            iconEl.className = 'toast-icon';
            iconEl.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i>`;
            head.appendChild(iconEl);
        }

        const body = document.createElement('div');
        body.className = 'toast-body';

        if (title) {
            const titleEl = document.createElement('strong');
            titleEl.className = 'toast-title';
            titleEl.textContent = title;
            body.appendChild(titleEl);
        }
        if (text) {
            const textEl = document.createElement('p');
            textEl.className = 'toast-text';
            textEl.textContent = text;
            body.appendChild(textEl);
        }

        head.appendChild(body);
        toast.appendChild(head);

        if (html) {
            const extra = document.createElement('div');
            extra.className = 'toast-extra';
            extra.innerHTML = html;
            toast.classList.add('has-extra');
            toast.appendChild(extra);
        }
    }

    showProgress({ title = 'Processando...', tasks = {}, labels = {}, priority = 10, closeDelay = 1200 }) {
        const state = { ...tasks };
        const totalTasks = Object.keys(state).length;

        const html = `
            <div class="toast-progress">
                <div class="toast-progress-head">
                    <strong class="toast-progress-title">${title}</strong>
                    <span class="toast-progress-percent">0%</span>
                </div>
                <div class="toast-progress-track">
                    <div class="toast-progress-bar"></div>
                </div>
                <div class="toast-progress-status">Iniciando...</div>
            </div>
        `;

        // duration: 0 impede o toast de fechar antes das tasks terminarem
        const toast = this.show({ html, duration: 0, priority });

        const barEl = toast.querySelector('.toast-progress-bar');
        const percentEl = toast.querySelector('.toast-progress-percent');
        const statusEl = toast.querySelector('.toast-progress-status');
        const titleEl = toast.querySelector('.toast-progress-title');

        const render = (lastTaskKey) => {
            const completedCount = Object.values(state).filter(Boolean).length;
            const percent = totalTasks === 0 ? 100 : Math.round((completedCount / totalTasks) * 100);

            barEl.style.width = `${percent}%`;
            percentEl.textContent = `${percent}%`;

            if (lastTaskKey && labels[lastTaskKey]) {
                statusEl.textContent = labels[lastTaskKey];
            }

            if (completedCount >= totalTasks) {
                toast.dataset.category = 'success';
                titleEl.textContent = 'Concluído!';
                statusEl.textContent = 'Todas as etapas finalizadas.';
                setTimeout(() => this.remove(toast), closeDelay);
            }
        };

        return {
            toast,
            /**
             * Atualiza uma task para true (ou false) e recalcula a barra
             */
            completeTask: (taskName, isDone = true) => {
                if (!(taskName in state)) return;
                state[taskName] = isDone;
                render(taskName);
            },
            /**
             * Caso ocorra erro no meio do processo
             */
            fail: (errorMessage = 'Erro ao salvar.') => {
                toast.dataset.category = 'error';
                toast.setAttribute('role', 'alert');
                titleEl.textContent = 'Falha';
                statusEl.textContent = errorMessage;
                setTimeout(() => this.remove(toast), 4000);
            }
        };
    }

    remove(toast) {
        if (toast.classList.contains('hiding')) return;
        toast.classList.remove('visible');
        toast.classList.add('hiding');

        const cleanup = () => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        };

        toast.addEventListener('transitionend', cleanup, { once: true });
        setTimeout(cleanup, 350);
    }
}

export const toaster = new ToastManager();