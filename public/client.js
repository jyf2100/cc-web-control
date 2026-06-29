/**
 * Claude Code Web - 终端镜像客户端
 * Web 端显示 tmux pane 快照，并将输入转发到 tmux
 */

(function() {
    'use strict';

    const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const WS_URL = `${WS_PROTOCOL}://${window.location.host}`;
    let defaultSession = 'claude-web-session';
    const RECONNECT_INTERVAL = 3000;

    // DOM 元素
    const messagesEl = document.getElementById('messages');
    const connectionStatus = document.getElementById('connectionStatus');
    const chatContainer = document.getElementById('chatContainer');
    const sessionSelect = document.getElementById('sessionSelect');
    const refreshSessionsBtn = document.getElementById('refreshSessions');
    const projectControl = document.getElementById('projectControl');
    const projectSelect = document.getElementById('projectSelect');
    const startProjectBtn = document.getElementById('startProject');

    // 状态
    let ws = null;
    let reconnectTimer = null;
    let isConnected = false;
    let lastOutput = null;
    let terminalContentEl = null;
    let terminalInputEl = null;
    let commandPalette = null;
    let terminalViewEl = null;
    let terminalHeaderEl = null;
    let currentSession = null;
    let disconnectNoted = false;
    let lastWsErrorNoted = false;
    const STORAGE_KEY_LAST_SESSION = 'cc_web_last_session';

    function getStoredSession() {
        try {
            const v = localStorage.getItem(STORAGE_KEY_LAST_SESSION);
            return v && typeof v === 'string' ? v : null;
        } catch {
            return null;
        }
    }

    function storeSession(name) {
        try {
            if (!name) return;
            localStorage.setItem(STORAGE_KEY_LAST_SESSION, String(name));
        } catch {}
    }

    const cleanOutput = (function () {
        try {
            if (window.TerminalCleaner && typeof window.TerminalCleaner.cleanOutput === 'function') {
                return window.TerminalCleaner.cleanOutput;
            }
        } catch {}
        return (output) => (typeof output === 'string' ? output : '');
    })();

    const tmuxActions = (function () {
        try {
            if (window.TmuxActions) return window.TmuxActions;
        } catch {}
        return null;
    })();

    function sendBatch(actions) {
        if (!ws || ws.readyState !== 1 || !isConnected) return;
        if (!Array.isArray(actions) || !actions.length) return;
        ws.send(JSON.stringify({ type: 'batch', data: actions }));
    }

    function getSessionFromUrl() {
        try {
            const url = new URL(window.location.href);
            const s = url.searchParams.get('session');
            return s && s.trim() ? s.trim() : null;
        } catch {
            return null;
        }
    }

    function setSessionInUrl(sessionName) {
        try {
            const url = new URL(window.location.href);
            url.searchParams.set('session', sessionName);
            window.history.replaceState({}, '', url.toString());
        } catch {}
    }

    async function loadConfig() {
        try {
            const cfg = await fetchJson('/api/config');
            const s = cfg && typeof cfg.defaultSession === 'string' ? cfg.defaultSession.trim() : '';
            if (s) defaultSession = s;
        } catch {
            // ignore: config is optional
        }
    }

    async function fetchJson(url, options) {
        const resp = await fetch(url, options);
        const text = await resp.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {}
        if (!resp.ok) {
            const message = (json && (json.error || json.message)) || `${resp.status} ${resp.statusText}`;
            throw new Error(message);
        }
        return json;
    }

    function slugifySessionName(name) {
        const base = String(name || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
        const cleaned = base || 'project';
        return cleaned.slice(0, 48);
    }

    /**
     * 滚动到底部
     */
    function scrollToBottom() {
        if (terminalContentEl) {
            const prevScrollTop = terminalContentEl.scrollTop;
            terminalContentEl.scrollTop = terminalContentEl.scrollHeight;
            if (window.ccModules?.updateScrollTop) {
                window.ccModules.updateScrollTop(prevScrollTop);
            }
        }
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    /**
     * 更新连接状态
     */
    function updateConnectionStatus(connected) {
        if (!connectionStatus) return;
        connectionStatus.textContent = connected ? '已连接' : '未连接';
        connectionStatus.classList.toggle('connected', connected);
        if (terminalInputEl) terminalInputEl.disabled = !connected;
    }

    /**
     * 确保终端镜像视图已创建
     */
    function ensureTerminalView() {
        if (terminalContentEl && terminalInputEl && terminalViewEl) {
            return { contentEl: terminalContentEl, inputEl: terminalInputEl, viewEl: terminalViewEl };
        }

        const welcome = messagesEl.querySelector('.welcome-message');
        if (welcome) welcome.remove();

        const terminalView = document.createElement('section');
        terminalView.className = 'terminal-view';

        const terminalHeader = document.createElement('div');
        terminalHeader.className = 'terminal-header';

        const headerTitle = document.createElement('span');
        headerTitle.className = 'terminal-header-title';
        headerTitle.textContent = currentSession ? `Session: ${currentSession}` : 'Roc-CC Remote Control';
        terminalHeader.appendChild(headerTitle);

        // 移动端止损：Esc / Ctrl+C 一键发送（桌面端隐藏，物理键盘已可直发）
        const stopControls = document.createElement('div');
        stopControls.className = 'stop-controls';
        const mkStop = (label, keyData) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn stop-btn';
            b.textContent = label;
            b.addEventListener('click', () => sendBatch([{ type: 'key', data: keyData }]));
            return b;
        };
        stopControls.append(mkStop('Esc', 'Escape'), mkStop('Ctrl+C', 'C-c'));
        terminalHeader.appendChild(stopControls);

        const terminalContent = document.createElement('pre');
        terminalContent.className = 'terminal-content';

        const inputRow = document.createElement('div');
        inputRow.className = 'terminal-input-row';

        const prompt = document.createElement('span');
        prompt.className = 'terminal-prompt';
        prompt.textContent = '❯';

        const inlineInput = document.createElement('textarea');
        inlineInput.className = 'terminal-inline-input terminal-inline-textarea';
        inlineInput.rows = 1;
        inlineInput.wrap = 'soft';
        inlineInput.placeholder = '输入后回车发送；Tab 补全；空输入时 Enter/↑/↓/Esc 发送按键';
        inlineInput.autocomplete = 'off';
        inlineInput.autocorrect = 'off';
        inlineInput.autocapitalize = 'off';
        inlineInput.spellcheck = false;

        inputRow.appendChild(prompt);
        inputRow.appendChild(inlineInput);
        terminalView.appendChild(terminalHeader);
        terminalView.appendChild(terminalContent);
        terminalView.appendChild(inputRow);
        messagesEl.appendChild(terminalView);

        terminalViewEl = terminalView;
        terminalHeaderEl = terminalHeader;
        terminalContentEl = terminalContent;
        terminalInputEl = inlineInput;

        // P0/P2/P4: Initialize modules after terminal view is created
        if (window.ccModules?.initP0) window.ccModules.initP0(terminalContent);
        if (window.ccModules?.initP4) window.ccModules.initP4(terminalContent);
        if (window.ccModules?.CommandPalette && terminalInputEl) {
            commandPalette = new window.ccModules.CommandPalette(terminalInputEl);
        }

        return { contentEl: terminalContentEl, inputEl: terminalInputEl, viewEl: terminalViewEl };
    }

    /**
     * 快捷回复：终端出现 y/n / continue? 等待输入时，给出 Yes/No/Continue 一键回复。
     * 仅扫描尾部 500 字，避免历史噪音；切会话时 hideQuickReply 清掉残留按钮。
     */
    let quickReplyBar = null;
    function shouldShowQuickReply(text) {
        const src = String(text || '');
        const tail = src.slice(-500).toLowerCase();
        if (!tail.trim()) return false;
        return /y\/n|\[y\/n\]|yes\/no|\(y\/n\)|continue\?/.test(tail)
            || /\?\s*$/.test(src.trim());
    }
    function hideQuickReply() {
        if (quickReplyBar) {
            quickReplyBar.remove();
            quickReplyBar = null;
        }
    }
    function showQuickReply() {
        if (quickReplyBar) return;
        const inputRow = document.querySelector('.terminal-input-row');
        if (!inputRow || !inputRow.parentElement) return;

        const bar = document.createElement('div');
        bar.className = 'quick-reply';
        const mk = (label, accent, actions) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'quick-reply-btn';
            b.textContent = label;
            b.style.borderColor = accent;
            b.addEventListener('click', () => {
                sendBatch(actions);
                hideQuickReply();
            });
            return b;
        };
        bar.append(
            mk('Yes', 'var(--brand)', [{ type: 'key', data: 'C-u' }, { type: 'input', data: 'y', enter: true }]),
            mk('No', 'var(--border)', [{ type: 'key', data: 'C-u' }, { type: 'input', data: 'n', enter: true }]),
            mk('Continue', 'var(--brand-strong)', [{ type: 'key', data: 'Enter' }])
        );

        inputRow.parentElement.insertBefore(bar, inputRow);
        quickReplyBar = bar;
    }
    function updateQuickReply() {
        if (shouldShowQuickReply(lastOutput)) showQuickReply();
        else hideQuickReply();
    }

    /**
     * 渲染终端快照（与 shell 同步）
     */
    function renderTerminal(output) {
        const { contentEl } = ensureTerminalView();

        // P0: Use virtual scroll if available and initialized
        if (window.ccModules?.renderTerminal && window.ccModules?.virtualScroll) {
            const lineRenderer = (line, index) => {
                const el = document.createElement('div');
                el.className = 'terminal-line';
                el.textContent = line;
                return el;
            };
            window.ccModules.renderTerminal(output, lineRenderer);
            return;
        }

        // Fallback: existing behavior
        const clean = cleanOutput(output);
        if (contentEl.textContent === clean) return;
        contentEl.textContent = clean;
        scrollToBottom();
    }

    /**
     * 在终端视图中追加系统状态
     */
    function showSystemNote(text) {
        const { contentEl } = ensureTerminalView();
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const stamp = `[${hh}:${mm}]`;
        const current = contentEl.textContent || '';
        contentEl.textContent = `${current}\n${stamp} ${text}`.trimStart();
        scrollToBottom();
    }

    /**
     * 发送命令
     */
    function sendCommand() {
        if (!terminalInputEl) return;

        const text = terminalInputEl.value;
        if (!isConnected) return;

        const raw = typeof text === 'string' ? text : '';
        const trimmed = raw.trim();

        // 空输入：发送一个纯按键（用于命令面板选择/确认等）
        if (!trimmed) {
            sendBatch([{ type: 'key', data: 'Enter' }]);
            return;
        }

        // Claude Code 的命令面板通常需要先输入 "/" 但不要立刻回车
        if (trimmed === '/') {
            if (tmuxActions?.buildSyncLine) {
                sendBatch(tmuxActions.buildSyncLine('/'));
            } else {
                sendBatch([{ type: 'key', data: 'C-u' }, { type: 'input', data: '/', enter: false }]);
            }
            terminalInputEl.value = '';
            showSystemNote('已发送 "/"（不回车），可继续输入命令名称并回车');
            return;
        }

        if (tmuxActions?.buildSubmitLine) {
            sendBatch(tmuxActions.buildSubmitLine(raw));
        } else {
            sendBatch([{ type: 'key', data: 'C-u' }, { type: 'input', data: raw, enter: true }]);
        }
        terminalInputEl.value = '';
    }

    /**
     * 绑定终端输入行为
     */
    function bindInlineInput() {
        const { inputEl, contentEl, viewEl } = ensureTerminalView();
        let slashSyncTimer = null;
        let composing = false;
        let lastSlashSyncedValue = null;

        const syncLineNow = (line) => {
            if (!isConnected) return;
            const latest = typeof line === 'string' ? line : String(line ?? '');
            if (tmuxActions?.buildSyncLine) {
                sendBatch(tmuxActions.buildSyncLine(latest));
            } else {
                sendBatch([{ type: 'key', data: 'C-u' }, { type: 'input', data: latest, enter: false }]);
            }
            if (latest.startsWith('/')) {
                lastSlashSyncedValue = latest;
            }
        };

        const scheduleSlashSync = () => {
            if (composing) return;
            if (!isConnected) return;
            const value = typeof inputEl.value === 'string' ? inputEl.value : '';
            if (!value.startsWith('/')) return;

            if (slashSyncTimer) clearTimeout(slashSyncTimer);
            slashSyncTimer = setTimeout(() => {
                if (!isConnected) return;
                const latest = typeof inputEl.value === 'string' ? inputEl.value : '';
                if (!latest.startsWith('/')) return;
                syncLineNow(latest);
            }, 120);
        };

        inputEl.addEventListener('compositionstart', () => {
            composing = true;
        });
        inputEl.addEventListener('compositionend', () => {
            composing = false;
            scheduleSlashSync();
        });
        // 粘贴多行提示：tmux 按行处理，换行会变成逐行 Enter，提前告知用户
        inputEl.addEventListener('paste', (e) => {
            const data = (e.clipboardData || window.clipboardData)?.getData('text');
            if (data && data.indexOf('\n') !== -1) {
                window.ccModules?.showToast?.(
                    '粘贴内容含换行，将按行逐条发送（每个换行触发一次回车）',
                    'info',
                    4000
                );
            }
        });
        inputEl.addEventListener('input', () => {
            scheduleSlashSync();
            // P2: Show/hide command palette on slash input
            const rawValue = typeof inputEl.value === 'string' ? inputEl.value : '';
            const slashMode = rawValue.startsWith('/');
            if (slashMode && commandPalette) {
                const commands = ['/model', '/claude', '/commit', '/review', '/ask', '/web', '/clear', '/help'];
                commandPalette.show(
                    commands,
                    (item, filter) => item.includes(filter) ? item : '',
                    (selected) => {
                        inputEl.value = selected + ' ';
                        inputEl.focus();
                    }
                );
            } else if (commandPalette) {
                commandPalette.hide();
            }
        });

        const isEditableTarget = (el) => {
            if (!el || typeof el !== 'object') return false;
            const tag = (el.tagName || '').toUpperCase();
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
            return !!el.isContentEditable;
        };

        // 让 web 操作习惯更像 Claude Code：不需要先点击输入框，按 "/" 就能进入命令面板
        document.addEventListener('keydown', (e) => {
            if (e.defaultPrevented) return;
            if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
            if (isEditableTarget(e.target)) return;

            e.preventDefault();
            if (inputEl.disabled) return;
            inputEl.focus({ preventScroll: true });

            // 只有在输入框为空时才自动写入 "/"，避免意外覆盖用户正在编辑的内容
            if (!inputEl.value) {
                inputEl.value = '/';
                syncLineNow('/');
            }
        }, true);

        inputEl.addEventListener('keydown', (e) => {
            // P2: Let command palette handle arrow/enter/escape when visible
            if (commandPalette?.handleKeyDown(e)) return;

            // Tab 在浏览器默认会切换焦点，这里改为发送给 tmux 做补全
            if (e.key === 'Tab' && !e.isComposing) {
                e.preventDefault();
                if (isConnected) {
                    const current = typeof inputEl.value === 'string' ? inputEl.value : '';
                    if (tmuxActions?.buildTabComplete) {
                        sendBatch(tmuxActions.buildTabComplete(current));
                    } else {
                        sendBatch([{ type: 'key', data: 'C-u' }, { type: 'input', data: current, enter: false }, { type: 'key', data: 'Tab' }]);
                    }
                }
                return;
            }

            // 方向键/ESC：在命令面板（/ 开头）或空输入时，转发给 tmux（用于命令面板/补全列表选择）
            if ((e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Escape') && !e.isComposing) {
                const rawValue = typeof inputEl.value === 'string' ? inputEl.value : '';
                const trimmed = rawValue.trim();
                const slashMode = rawValue.startsWith('/');

                if ((slashMode || !trimmed) && isConnected) {
                    e.preventDefault();
                    const keyName =
                        e.key === 'ArrowUp' ? 'Up' :
                        e.key === 'ArrowDown' ? 'Down' :
                        'Escape';
                    sendBatch([{ type: 'key', data: keyName }]);
                    if (keyName === 'Escape' && slashMode) {
                        inputEl.value = '';
                    }
                    return;
                }
            }

            if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                const rawValue = typeof inputEl.value === 'string' ? inputEl.value : '';
                const trimmed = rawValue.trim();
                const slashMode = rawValue.startsWith('/');

                if (slashMode && isConnected) {
                    // 纯 "/"：只同步不回车（避免误触执行第一项命令）
                    if (trimmed === '/') {
                        syncLineNow('/');
                        inputEl.value = '';
                        showSystemNote('已发送 "/"（不回车），可继续输入命令名称并回车');
                        return;
                    }

                    // Slash 命令：优先只发 Enter（不重写输入行），避免重置命令面板的光标选择
                    // 若 web 输入与 tmux 行不同步，再做一次“同步 + Enter”兜底。
                    if (rawValue === lastSlashSyncedValue) {
                        sendBatch([{ type: 'key', data: 'Enter' }]);
                    } else if (tmuxActions?.buildSyncAndKey) {
                        sendBatch(tmuxActions.buildSyncAndKey(rawValue, 'Enter'));
                    } else if (tmuxActions?.buildSyncLine) {
                        sendBatch([...tmuxActions.buildSyncLine(rawValue), { type: 'key', data: 'Enter' }]);
                    } else {
                        sendBatch([{ type: 'key', data: 'C-u' }, { type: 'input', data: rawValue, enter: false }, { type: 'key', data: 'Enter' }]);
                    }
                    inputEl.value = '';
                    return;
                }

                sendCommand();
            }
        });

        // 点击终端任意区域都能回到输入焦点，移动端更容易触发键盘
        const focusInput = () => {
            if (!isConnected || inputEl.disabled) return;
            inputEl.focus({ preventScroll: true });
        };

        contentEl.addEventListener('click', focusInput);
        viewEl.addEventListener('click', focusInput);
        viewEl.addEventListener('touchend', () => {
            setTimeout(focusInput, 0);
        }, { passive: true });
    }

    /**
     * 连接 WebSocket
     */
    function connect() {
        if (ws) {
            try {
                ws.onopen = null;
                ws.onmessage = null;
                ws.onerror = null;
                ws.onclose = null;
                ws.close();
            } catch {}
        }

        const sessionName = currentSession || defaultSession;
        const wsUrl = `${WS_URL}/?session=${encodeURIComponent(sessionName)}`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            isConnected = true;
            disconnectNoted = false;
            lastWsErrorNoted = false;
            updateConnectionStatus(true);
            window.ccModules?.showToast?.('已连接', 'success');
            if (terminalInputEl && !terminalInputEl.disabled) {
                terminalInputEl.focus({ preventScroll: true });
            }
            console.log('[WS] 已连接');
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);

                if (msg.type === 'error') {
                    showSystemNote(String(msg.data || '发生错误'));
                    return;
                }

                if (msg.type !== 'output' && msg.type !== 'init') return;

                const output = msg.data;
                if (output === lastOutput) return;

                lastOutput = output;
                renderTerminal(output);
                updateQuickReply();
            } catch (e) {
                console.error('[WS] 解析失败:', e);
            }
        };

        ws.onclose = (event) => {
            isConnected = false;
            updateConnectionStatus(false);
            window.ccModules?.showToast?.('连接已断开，正在重连', 'error', 5000);
            if (!disconnectNoted) {
                disconnectNoted = true;
                const code = event && typeof event.code === 'number' ? event.code : null;
                const reason = event && typeof event.reason === 'string' ? event.reason : '';
                const suffix = code !== null ? `（code=${code}${reason ? `, reason=${reason}` : ''}）` : '';
                showSystemNote(`连接已断开${suffix}，正在重连...`);
            }
            scheduleReconnect();
        };

        ws.onerror = (err) => {
            window.ccModules?.showToast?.('WebSocket 连接异常', 'error', 5000);
            console.error('[WS] 错误:', err);
            if (!lastWsErrorNoted) {
                lastWsErrorNoted = true;
                showSystemNote('WebSocket 连接异常（可打开浏览器控制台查看详情）');
            }
        };
    }

    /**
     * 重连
     */
    function scheduleReconnect() {
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, RECONNECT_INTERVAL);
    }

    function updateSessionUi() {
        if (terminalHeaderEl) {
            const titleEl = terminalHeaderEl.querySelector('.terminal-header-title');
            if (titleEl) {
                titleEl.textContent = currentSession ? `Session: ${currentSession}` : 'Roc-CC Remote Control';
            }
        }
        if (sessionSelect && currentSession) {
            sessionSelect.value = currentSession;
        }
    }

    async function loadSessions() {
        if (!sessionSelect) return;
        try {
            const sessions = await fetchJson('/api/sessions');
            sessionSelect.innerHTML = '';

            const names = Array.isArray(sessions) ? sessions.map(s => s.name) : [];
            const urlSession = getSessionFromUrl();
            const stored = getStoredSession();

            // URL 明确指定 session 时，绝不自动切换，避免用户以为自己在操作 A 实际连到 B
            if (!urlSession) {
                // 先优先恢复 localStorage
                if (!currentSession && stored) currentSession = stored;

                // 若当前 session 不存在，按优先级回退：stored -> default -> attached -> first
                const exists = currentSession && names.includes(currentSession);
                if (!exists) {
                    const attached = Array.isArray(sessions) ? sessions.find(s => s && s.attached) : null;
                    const next =
                        (stored && names.includes(stored) && stored) ||
                        (defaultSession && names.includes(defaultSession) && defaultSession) ||
                        (attached && attached.name) ||
                        (names[0] || defaultSession);

                    if (next && next !== currentSession) {
                        currentSession = next;
                        setSessionInUrl(currentSession);
                        storeSession(currentSession);
                        updateSessionUi();
                        lastOutput = null;
                        hideQuickReply();
                        if (ws) connect();
                    }
                } else if (currentSession) {
                    storeSession(currentSession);
                }
            }
            if (currentSession && !names.includes(currentSession)) {
                const opt = document.createElement('option');
                opt.value = currentSession;
                opt.textContent = `${currentSession} (missing)`;
                sessionSelect.appendChild(opt);
            }

            for (const s of sessions) {
                const opt = document.createElement('option');
                opt.value = s.name;
                opt.textContent = s.attached ? `${s.name} (attached)` : s.name;
                sessionSelect.appendChild(opt);
            }

            if (!currentSession) {
                currentSession = names.includes(defaultSession) ? defaultSession : (names[0] || defaultSession);
                setSessionInUrl(currentSession);
                storeSession(currentSession);
            }

            updateSessionUi();
        } catch (e) {
            showSystemNote(`无法加载会话列表: ${e.message}`);
        }
    }

    async function loadProjects() {
        if (!projectSelect || !projectControl || !startProjectBtn) return;
        const projectsEmptyEl = document.getElementById('projectsEmpty');
        const resolveView = ({ projects, hasRoots }) => {
            const fn = (typeof ProjectsView !== 'undefined' && ProjectsView.projectsView) || null;
            return fn
                ? fn({ projects, hasRoots })
                : { showSelect: projects.length > 0, showButton: projects.length > 0, emptyHint: '' };
        };
        const applyView = (view) => {
            projectControl.hidden = !view.showSelect;
            startProjectBtn.hidden = !view.showButton;
            if (projectsEmptyEl) {
                if (view.emptyHint) {
                    projectsEmptyEl.textContent = view.emptyHint;
                    projectsEmptyEl.hidden = false;
                } else {
                    projectsEmptyEl.textContent = '';
                    projectsEmptyEl.hidden = true;
                }
            }
        };
        try {
            const data = await fetchJson('/api/projects');
            const projects = data && Array.isArray(data.projects) ? data.projects : [];
            const hasRoots = Boolean(data && Array.isArray(data.roots) && data.roots.length > 0);
            applyView(resolveView({ projects, hasRoots }));
            if (!projects.length) return;

            projectSelect.innerHTML = '';
            for (const p of projects) {
                const opt = document.createElement('option');
                opt.value = p.path;
                opt.dataset.projectName = p.name;
                if (p.root) opt.dataset.projectRoot = p.root;
                opt.textContent = p.root ? `${p.name} (${p.root})` : p.name;
                projectSelect.appendChild(opt);
            }
        } catch {
            applyView(resolveView({ projects: [], hasRoots: false }));
        }
    }

    async function startProjectSession() {
        if (!projectSelect) return;
        const cwd = projectSelect.value;
        if (!cwd) return;

        const selectedOption = projectSelect.options[projectSelect.selectedIndex];
        const projectName = selectedOption?.dataset?.projectName || selectedOption?.textContent || cwd;
        const sessionName = `claude-${slugifySessionName(projectName)}`;

        try {
            const sessions = await fetchJson('/api/sessions');
            const names = Array.isArray(sessions) ? sessions.map(s => s.name) : [];
            if (names.includes(sessionName)) {
                currentSession = sessionName;
                setSessionInUrl(currentSession);
                storeSession(currentSession);
                updateSessionUi();
                lastOutput = null;
                hideQuickReply();
                connect();
                showSystemNote(`已切换到会话: ${sessionName}`);
                const entry = Array.isArray(sessions) ? sessions.find((s) => s && s.name === sessionName) : null;
                const detect = (typeof DeadState !== 'undefined' && DeadState.detectDeadState) || null;
                if (detect && entry) {
                    const dead = detect({ name: entry.name, claudeSessionId: entry.claudeSessionId });
                    if (dead.shouldHint) showSystemNote(dead.hint);
                }
                return;
            }

            await fetchJson('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: sessionName, cwd })
            });

            currentSession = sessionName;
            setSessionInUrl(currentSession);
            storeSession(currentSession);
            updateSessionUi();
            lastOutput = null;
            hideQuickReply();
            connect();
            await loadSessions();
            showSystemNote(`已启动项目会话: ${sessionName}`);
        } catch (e) {
            const msg = String(e.message || e || 'unknown error');
            if (msg.includes('already exists')) {
                currentSession = sessionName;
                setSessionInUrl(currentSession);
                storeSession(currentSession);
                updateSessionUi();
                lastOutput = null;
                hideQuickReply();
                connect();
                showSystemNote(`已切换到会话: ${sessionName}`);
                return;
            }
            showSystemNote(`启动项目失败: ${msg}`);
        }
    }

    /**
     * 初始化
     */
    function init() {
        currentSession = getSessionFromUrl() || getStoredSession() || defaultSession;
        if (currentSession) {
            setSessionInUrl(currentSession);
            storeSession(currentSession);
        }

        ensureTerminalView();
        bindInlineInput();
        updateConnectionStatus(false);

        // Bootstrap in order: config -> sessions/projects -> ws connect
        (async () => {
            await loadConfig();
            if (!getSessionFromUrl()) {
                // If URL didn't explicitly pin a session, update to server default if needed.
                if (!getStoredSession() && defaultSession && currentSession !== defaultSession) {
                    currentSession = defaultSession;
                    setSessionInUrl(currentSession);
                    storeSession(currentSession);
                    updateSessionUi();
                }
            }
            await loadSessions();
            await loadProjects();
            connect();
        })();

        if (refreshSessionsBtn) {
            refreshSessionsBtn.addEventListener('click', () => {
                loadSessions();
                loadProjects();
            });
        }

        if (sessionSelect) {
            sessionSelect.addEventListener('change', () => {
                const next = sessionSelect.value;
                if (!next || next === currentSession) return;
                currentSession = next;
                setSessionInUrl(currentSession);
                storeSession(currentSession);
                updateSessionUi();
                lastOutput = null;
                hideQuickReply();
                showSystemNote(`切换会话: ${currentSession}`);
                connect();
            });
        }

        if (startProjectBtn) {
            startProjectBtn.addEventListener('click', () => startProjectSession());
        }

        let resizeTimer = null;
        window.addEventListener('resize', () => {
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (window.ccModules?.virtualScroll) {
                    window.ccModules.virtualScroll.remeasure();
                }
            }, 100);
        });

        console.log('[App] 初始化完成');
    }

    // 启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
