# TODOS

## Review

Items surfaced by `/plan-ceo-review` on 2026-06-27 (multi-session dashboard review, branch main).

### Existing single-session control path: cut capturePane spawn cost

**What:** Refactor the focused-session control path (server.cjs:489-509 + tmux.cjs `capturePane`) to use tail-only capture (`capture-pane -p -S -20`) and add a concurrency cap (token bucket, ~4), instead of 2 full-buffer tmux spawns (has-session + capture-pane) every 100ms per connected WS client.

**Why:** ~20 tmux process spawns/sec per client is a latent CPU/battery drain, acute on the phone-over-tunnel path. The new dashboard avoids this (JSONL = 0 spawns), but the control path you click into still pays it.

**Context:** Pre-existing debt surfaced during the dashboard review (not introduced by the dashboard). The dashboard feature deliberately does NOT touch this path to keep its diff minimal. Audit found silent `catch(e){}` swallowing at server.cjs:487 and 505 in this same path, fix those while here. Start at `tmux.cjs:94` `capturePane()` (checkSession 1 spawn + capture-pane 1 spawn, full buffer) and the per-client `setInterval(POLL_INTERVAL)` at server.cjs:489. REPO_MODE=solo so this is ours to fix.

**Effort:** S (human M, CC S)
**Priority:** P2
**Depends on:** None (independent of the dashboard feature)

### Per-session history timeline

**What:** Click a session row to see its turn-by-turn history timeline (what it did while you were away), parsed from the same JSONL the dashboard already reads.

**Why:** Phase 1 dashboard is a snapshot ("which session needs me now"). History answers a different question ("what did this session do while I was away"), turning the dashboard from a glance into an audit log. Reuses the Phase 1 JSONL reader, so the marginal cost is mostly UI.

**Context:** 10x-vision item from the CEO review, deferred so Phase 1 ships the reactive "which needs me now" job first. JSONL files can be large, so this needs windowing/tail on the read side (don't load whole file). Note JSONL lacks a clean per-turn boundary beyond the assistant/user event pairs and `stop_reason`. Depends on the Phase 1 JSONL reader existing.

**Effort:** S (human M, CC S)
**Priority:** P3
**Depends on:** Phase 1 JSONL status reader

### Component class sharing across pages

**What:** Extract shared component classes (`.btn`, `.btn.brand`, `.card`, `.badge`) out of page-specific CSS into a shared `components.css` (or fold into `tokens.css`), so the three pages (index / dashboard / login) don't each redefine the same button/card/badge look. Currently `.btn` lives in style.css, `.badge` in dashboard.css, `.btn.brand` duplicated in the mockups.

**Why:** The ui-redesign ships a single tokens.css (colors/type/radius/spacing) shared by all three pages, but component-level classes are still per-page. Once tokens land, the remaining duplication is component classes. Sharing them is the natural Phase 2 cleanup to finish "one unified site."

**Context:** Surfaced by /plan-eng-review on 2026-06-27 (ui-redesign spec review, commit 373a57c). Deliberately deferred from Phase 1 of the redesign to keep the tokens.css diff focused. After tokens.css lands, audit `.btn` / `.card` / `.badge` across the three stylesheets and consolidate. Note the client.js DOM locklist constrains class names that JS toggles (connected, terminal-*, welcome-message), those must stay even when consolidated.

**Effort:** S (human S, CC S)
**Priority:** P3
**Depends on:** ui-redesign tokens.css landing

## Completed

(none yet)
