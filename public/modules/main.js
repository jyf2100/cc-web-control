import { TerminalModel } from './terminal_model.js';
import { VirtualScrollView } from './virtual_scroll.js';
import { PretextMeasurer } from './pretext_measurer.js';
import { ToastManager } from './toast_manager.js';
import { MultiLineInput } from './multi_line_input.js';
import { FONTS } from './fonts.js';
import { FontScaler } from './font_scaler.js';
import { CommandPalette } from './command_palette.js';
import { createPendingActionController } from './pending_action.js';

let terminalModel = null;
let virtualScroll = null;
let pretextMeasurer = null;
let toastManager = null;
let multiLineInput = null;
let lineHeight = 20;
let _prevScrollTop = 0;

function initP0(container) {
    terminalModel = new TerminalModel();
    lineHeight = measureLineHeight(container);
    virtualScroll = new VirtualScrollView(container, lineHeight);
}

function measureLineHeight(container) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;';
    probe.style.fontFamily = "'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', monospace";
    probe.style.fontSize = '13px';
    probe.style.lineHeight = '1.5';
    probe.textContent = 'x';
    container.appendChild(probe);
    const h = probe.offsetHeight;
    probe.remove();
    return h || 20;
}

function renderTerminal(output, lineRenderer) {
    if (!terminalModel || !virtualScroll) return;
    const changed = terminalModel.replace(output);
    if (!changed) return;
    const scrollTop = _prevScrollTop;
    virtualScroll.render(terminalModel, lineRenderer);
    if (virtualScroll.wasAtBottom(scrollTop)) {
        virtualScroll.scrollToBottom();
    }
}

function updateScrollTop(scrollTop) {
    _prevScrollTop = scrollTop;
}

function initP1(container) {
    try {
        pretextMeasurer = new PretextMeasurer();
        toastManager = new ToastManager(container, pretextMeasurer);
    } catch (e) {
        console.warn('[P1] Toast init failed, toasts disabled:', e);
    }
}

function showToast(message, type = 'info', duration = 3000) {
    toastManager?.show(message, type, duration);
}

function initP3(textarea, terminalView) {
    if (!pretextMeasurer) {
        try {
            pretextMeasurer = new PretextMeasurer();
        } catch (e) {
            console.warn('[P3] pretext unavailable, multi-line disabled:', e);
            return;
        }
    }
    multiLineInput = new MultiLineInput(textarea, terminalView, pretextMeasurer);
}

let fontScaler = null;

function initP4(container) {
    fontScaler = new FontScaler(container);
}

function applyOptimalFontSize(totalLines, viewportHeight) {
    if (!fontScaler) return;
    const { fontSize, lineHeight } = fontScaler.selectSize(totalLines, viewportHeight);
    const terminalContent = document.querySelector('.terminal-content');
    if (terminalContent) {
        terminalContent.style.fontSize = `${fontSize}px`;
        terminalContent.style.lineHeight = String(lineHeight / fontSize);
    }
}

window.ccModules = {
    initP0,
    initP1,
    initP3,
    initP4,
    renderTerminal,
    updateScrollTop,
    showToast,
    applyOptimalFontSize,
    createPendingActionController,
    get terminalModel() { return terminalModel; },
    get virtualScroll() { return virtualScroll; },
    get toastManager() { return toastManager; },
    get lineHeight() { return lineHeight; },
    FONTS,
    CommandPalette,
};

document.addEventListener('DOMContentLoaded', () => {
    const terminalContent = document.querySelector('.terminal-content');
    if (terminalContent) {
        initP0(terminalContent);
        initP4(terminalContent);
    }
    const toastContainer = document.getElementById('toast-container');
    if (toastContainer) {
        initP1(toastContainer);
    }
    const textarea = document.querySelector('.terminal-inline-textarea, .terminal-inline-input');
    const terminalView = document.querySelector('.terminal-view');
    if (textarea && terminalView) {
        initP3(textarea, terminalView);
    }
});
