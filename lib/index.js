/**
 * runcode-mode —— DSH「无提示词、只有 run_code」模式的伴生插件。
 *
 * 该插件被挂载在 runcode preset 的隔离作用域里，负责一件事：在 `agent/pre-step` 这一层
 * 剥离「由插件注入的合成消息」（例如 Hindsight 记忆块、时间上下文、技能目录等），
 * 让这个模式真正做到「无注入」。
 *
 * 为什么放在 agent/pre-step：
 *   persona 的 complete:true 只能覆盖 system-prompt 通道；许多插件会把内容以「合成 user 消息」
 *   的形式塞进对话（例如 Hindsight 用 host 平面的 agent/pre-step prepend 监听器追加一条
 *   source.kind === 'plugin:hindsight' 的消息）。preset 无法卸载 host 平面，只能用自己的
 *   prepend 监听器包住最外层 waterfall：await next() 拿到最终决策后改写 messages。
 *
 * 为什么作用域能收到 agent 事件：
 *   agent-preset-registry 在 mount 时把 agent 的 scope key 挂到 preset generation key 之下
 *   （bind/join -> bindScopeParent），因此 preset 内插件（tag = generation key）位于 agent
 *   事件的祖先链上，能收到该 agent 的所有 agent/* 事件。
 */

const name = 'runcode-mode';

/** 需要保留的消息来源 kind —— 真实对话内容。其余 kind 一律视为注入并剥离。 */
const KEEP_KINDS = new Set([
  'user',
  'model',
  'tool',
  'compact-checkpoint',
  'user-approval',
  'user-question-reply',
]);

function sourceKind(message) {
  const kind = message && message.source ? message.source.kind : void 0;
  return typeof kind === 'string' ? kind : void 0;
}

/** @returns {boolean} true 表示这条消息是插件注入，应被剥离。 */
function isInjected(message, keepKinds) {
  const kind = sourceKind(message);
  if (kind === void 0) return false;
  if (keepKinds.has(kind)) return false;
  return true;
}

function apply(ctx, config) {
  const options = config || {};
  if (options.stripInjectedMessages === false) return;
  const extra = Array.isArray(options.keepKinds)
    ? options.keepKinds.filter((k) => typeof k === 'string')
    : [];
  const keepKinds = new Set([...KEEP_KINDS, ...extra]);

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision === null || decision === void 0) return decision;
    if (decision.kind !== 'enter') return decision;
    const messages = decision.messages;
    if (!Array.isArray(messages) || messages.length === 0) return decision;
    const kept = messages.filter((message) => !isInjected(message, keepKinds));
    if (kept.length === messages.length) return decision;
    const logger = ctx.get('logger');
    if (logger && typeof logger.debug === 'function') {
      logger.debug('runcode-mode: stripped ' + (messages.length - kept.length) + ' injected message(s)');
    }
    return { ...decision, messages: kept };
  }, { prepend: true });
}

export { apply, name };