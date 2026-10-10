/** Recovery is Task-owned; native per-provider retry policies grant no extra attempts. */
export const RECOVERY_LIMITS = Object.freeze({ attempts: 2, delayMs: 500, totalWaitMs: 1000 });
export const defaultRecoveryPolicy = () => ({ enabled: false, automatic: false, alternativeCandidateId: null, maxTokens: 512, forecastTokens: 32768 });
export const recoveryForecast = (totalTokens, maxTokens) => ({ inputTokens: totalTokens - maxTokens, outputTokens: maxTokens, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens });
export function recoverPendingRecovery(task) {
  const state = task.recovery;
  if (!state) return false;
  if (state.version !== 1 || typeof state.id !== 'string' || !Number.isSafeInteger(state.revision) || state.revision < 1 || !Number.isSafeInteger(state.attempts) || state.attempts < 0 || state.attempts > RECOVERY_LIMITS.attempts || !Number.isFinite(state.waitMs) || state.waitMs < 0 || state.waitMs > RECOVERY_LIMITS.totalWaitMs || !['planning', 'backoff', 'waiting-user', 'resolving', 'ready', 'call-reserved', 'paused', 'completed'].includes(state.state)) throw new Error('Unsupported DSH Router recovery state');
  if (['completed', 'paused'].includes(state.state)) return false;
  state.interruptedState = state.state; state.state = 'paused'; state.reason = 'RECOVERY_RESTARTED_UNKNOWN'; state.revision++;
  task.routingPauseReason = state.reason;
  (task.timeline ??= []).push({ kind: 'recovery-restarted', recoveryId: state.id, reason: state.reason });
  return true;
}
export function failureFacts(failure) {
  const facts = { code: typeof failure?.code === 'string' ? failure.code : 'RECOVERY_FAILURE_UNKNOWN' };
  if (Number.isInteger(failure?.status) && failure.status >= 100 && failure.status <= 599) facts.status = failure.status;
  if (Number.isFinite(failure?.providerRetryAfterMs) && failure.providerRetryAfterMs > 0) facts.providerRetryAfterMs = failure.providerRetryAfterMs;
  if (typeof failure?.requestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(failure.requestId)) facts.requestId = failure.requestId;
  return facts;
}
export function classifyFailure(failure) {
  failure = { ...failure, code: failure.code.toUpperCase() };
  if (['SUBSCRIPTION_SHARING_USAGE_LIMIT_EXCEEDED', 'INSUFFICIENT_QUOTA'].includes(failure.code)) return 'quota';
  if (['INVALID_GRANT', 'INVALID_REFRESH_TOKEN', 'TOKEN_EXPIRED', 'REFRESH_TOKEN_EXPIRED', 'REFRESH_TOKEN_INVALIDATED', 'REFRESH_TOKEN_REUSED', 'TOKEN_REVOKED', 'CHATPASS_V2_SCOPE_NOT_AUTHORIZED'].includes(failure.code)) return 'authorization';
  if (['QUOTA', 'ACCOUNT_QUOTA', 'QUOTA_EXCEEDED'].includes(failure.code)) return 'quota';
  if (['AUTH', 'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL', 'AUTHORIZATION_CHANGED', 'AUTHORIZATION_REQUIRED', 'AUTHORIZATION_FAILED', 'CHATGPT_PLAN_SCOPE_MISSING', 'OAUTH_REFRESH_REJECTED', 'OAUTH_TOKEN_FAILED', 'OAUTH_REFRESH_FAILED'].includes(failure.code) || [401, 403].includes(failure.status)) return 'authorization';
  if (['STREAM_CLOSED', 'RESPONSE_INCOMPLETE', 'RESPONSE_FAILED', 'INVALID_RESPONSE', 'MALFORMED_RESPONSE', 'EMPTY_RESPONSE'].includes(failure.code)) return 'response-unknown';
  if (['ABORTED', 'CANCELED', 'HUMAN_INPUT_PENDING', 'NATIVE_SELECTION_CHANGED'].includes(failure.code)) return 'control';
  if (['CONTEXT_WINDOW_EXCEEDED', 'INVALID_PREPARED_CALL', 'REQUEST_TOO_LARGE', 'UNSUPPORTED_CONTENT', 'UNSUPPORTED_REQUEST'].includes(failure.code) || failure.code.startsWith('TAKEOVER_')) return 'handoff';
  if (['RATE_LIMIT', 'HTTP_429'].includes(failure.code) || failure.status === 429) return 'rate-limit';
  return ['CONNECTION', 'NETWORK_ERROR', 'TRANSPORT', 'TIMEOUT', 'SERVER', 'SOURCE_TIMEOUT'].includes(failure.code) || failure.status >= 500 ? 'network' : 'unknown';
}
