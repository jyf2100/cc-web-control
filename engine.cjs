/**
 * engine.cjs — 会话引擎元数据(纯叶子模块,零依赖)。
 * engine 可取 'claude'(缺省,Claude Code CLI)或 'codex'(OpenAI Codex CLI);
 * 命令名 / 安装提示集中在此,供 config_loader(schema 合法值)、bin(依赖门)、
 * server(启动前依赖检查)三处共享,避免 magic-string 漂移。
 */
'use strict';

const ENGINE_META = {
  claude: {
    command: 'claude',
    // 依赖门(formatMissing)与 server Init 日志共用同一句提示。
    installHint: '安装 Claude Code CLI 并完成 Claude 登录认证（https://claude.com/claude-code）',
  },
  codex: {
    command: 'codex',
    installHint: '安装 OpenAI Codex CLI：npm install -g @openai/codex',
  },
};

const DEFAULT_ENGINE = 'claude';
const ENGINE_VALUES = Object.keys(ENGINE_META);

function isKnownEngine(engine) {
  return Object.prototype.hasOwnProperty.call(ENGINE_META, engine);
}

// 未知引擎一律回退 claude 元数据(与 config_loader enum 降级口径一致)。
function engineMeta(engine) {
  return isKnownEngine(engine) ? ENGINE_META[engine] : ENGINE_META[DEFAULT_ENGINE];
}

function engineCommand(engine) {
  return engineMeta(engine).command;
}

function engineInstallHint(engine) {
  return engineMeta(engine).installHint;
}

module.exports = {
  ENGINE_META,
  DEFAULT_ENGINE,
  ENGINE_VALUES,
  isKnownEngine,
  engineMeta,
  engineCommand,
  engineInstallHint,
};
