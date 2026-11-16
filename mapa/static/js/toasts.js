class ToastManager {
    constructor() {

        this.container = document.getElementById('toast-container');
        if (!this.container) {
        this.container = document.createElement('div');
        this.container.id = 'toast-container';
        document.body.appendChild(this.container);
        }
    }

    show(options) {
        const { 
        text, 
        html = null, 
        duration = 5000, 
        priority = 1 
        } = options;

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.dataset.priority = priority;

        if (html) {
        toast.innerHTML = html;
        } else {
        toast.innerText = text;
        }



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

    showProgress({ title = 'Processando...', tasks = {}, labels = {}, priority = 10, closeDelay = 1200 }) {
        const state = { ...tasks };
        const totalTasks = Object.keys(state).length;

        const html = `
            <div class="toast-progress-wrapper" style="min-width: 240px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 0.9rem;">
                    <strong class="toast-progress-title">${title}</strong>
                    <span class="toast-progress-percent">0%</span>
                </div>
                <div class="toast-progress-track" style="width: 100%; height: 6px; background: rgba(255,255,255,0.2); border-radius: 999px; overflow: hidden;">
                    <div class="toast-progress-bar" style="width: 0%; height: 100%; background: #4ade80; transition: width 0.25s ease;"></div>
                </div>
                <div class="toast-progress-status" style="margin-top: 6px; font-size: 0.78rem; opacity: 0.85;">
                    Iniciando...
                </div>
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
                barEl.style.background = '#f87171';
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