export function createPendingActionController(button, options = {}) {
    if (!button) {
        throw new Error('button is required');
    }

    const idleLabel = options.idleLabel ?? button.textContent ?? '';
    const pendingLabel = options.pendingLabel ?? idleLabel;
    const relatedControls = Array.isArray(options.relatedControls)
        ? options.relatedControls.filter(Boolean)
        : [];

    let pending = false;

    const apply = () => {
        button.disabled = pending;
        button.textContent = pending ? pendingLabel : idleLabel;
        if (button.dataset) {
            button.dataset.pending = pending ? 'true' : 'false';
        }

        for (const control of relatedControls) {
            control.disabled = pending;
        }
    };

    apply();

    return {
        isPending() {
            return pending;
        },
        start() {
            if (pending) return false;
            pending = true;
            apply();
            return true;
        },
        finish() {
            pending = false;
            apply();
        },
        setPending(nextPending) {
            pending = !!nextPending;
            apply();
            return pending;
        },
    };
}
