import { FONTS } from './fonts.js';

export class ToastManager {
    #container;
    #toasts = [];
    #measurer;
    #toastWidth = 320;
    #toastLineHeight = 20;
    #toastGap = 8;
    #maxMessageLength = 500;

    constructor(container, measurer) {
        this.#container = container;
        this.#measurer = measurer;
    }

    show(message, type = 'info', duration = 3000) {
        if (message.length > this.#maxMessageLength) {
            message = message.slice(0, this.#maxMessageLength) + '…';
        }
        const { height } = this.#measurer.measureHeight(
            message,
            FONTS.toast,
            this.#toastWidth,
            this.#toastLineHeight
        );

        const top = this.#toasts.reduce(
            (sum, t) => sum + t.height + this.#toastGap,
            this.#toastGap
        );

        const toast = { message, type, height, top, el: null };

        const el = document.createElement('div');
        el.className = `toast toast-${type}`;
        el.setAttribute('role', 'alert');
        el.setAttribute('aria-live', 'assertive');
        el.style.top = `${top}px`;
        el.style.width = `${this.#toastWidth}px`;
        el.style.height = `${height}px`;
        el.style.lineHeight = `${this.#toastLineHeight}px`;
        el.textContent = message;

        toast.el = el;
        this.#container.appendChild(el);
        this.#toasts.push(toast);

        setTimeout(() => this.#dismiss(toast), duration);
    }

    #dismiss(toast) {
        toast.el?.remove();
        this.#toasts = this.#toasts.filter(t => t !== toast);
        this.#reposition();
    }

    #reposition() {
        let top = this.#toastGap;
        for (const toast of this.#toasts) {
            toast.top = top;
            toast.el.style.top = `${top}px`;
            top += toast.height + this.#toastGap;
        }
    }
}
