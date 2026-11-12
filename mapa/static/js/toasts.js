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