import { z } from 'zod';
import { candidateSnapshotSchema, sameIdentity } from './connections.mjs';
import { assertDeepSeekModelId } from './deepseek-connections.mjs';

const id = z.string().min(1).max(500);
const bindingSchema = z.object({
  accountId: id,
  configured: z.boolean(),
  writable: z.boolean(),
}).strict();
const connectionSchema = z.object({
  connectionId: id,
  accountId: id,
  provider: id,
  configured: z.boolean(),
}).strict();
const catalogSchema = z.object({
  status: z.enum(['not-requested', 'listed', 'error']),
  models: z.array(z.object({ id: id, name: z.string().min(1).max(300) }).strict()).max(1000),
  unrecognizedModelIds: z.array(id).max(1000),
}).strict();
export const deepSeekUiSnapshotSchema = z.object({
  bindings: z.array(bindingSchema).max(1000),
  connections: z.array(connectionSchema).max(1000),
  catalog: catalogSchema,
}).strict();

export const deepSeekDetectionRequestSchema = z.object({
  candidateId: id,
  budget: z.object({
    tokens: z.number().int().positive().safe().max(4096),
    durationMs: z.number().int().positive().safe().max(60_000),
  }).strict(),
}).strict();

const requests = {
  saveCredential: z.object({ apiKey: z.string().min(1).max(4096) }).strict(),
  connect: z.object({ accountId: id }).strict(),
  disconnect: z.object({ connectionId: id, deleteCredential: z.boolean() }).strict(),
  runDetection: deepSeekDetectionRequestSchema,
};

export const deepSeekUiSchemaFactories = Object.freeze([
  { name: 'DeepSeekUiSnapshot', create: () => deepSeekUiSnapshotSchema },
  { name: 'DeepSeekSaveCredentialRequest', create: () => requests.saveCredential },
  { name: 'DeepSeekConnectRequest', create: () => requests.connect },
  { name: 'DeepSeekDisconnectRequest', create: () => requests.disconnect },
  { name: 'DeepSeekDetectionRequest', create: () => deepSeekDetectionRequestSchema },
]);

const detectionViewSchema = z.object({
  taskId: id,
  lifecycle: z.enum(['completed', 'paused']),
  result: z.string(),
  budget: z.object({
    tokens: z.number().int().positive().safe().max(4096),
    durationMs: z.number().int().positive().safe().max(60_000),
    money: z.array(z.json()).max(0),
  }).strict(),
  ledger: z.object({
    tokens: z.json(),
    knownTokens: z.json(),
    money: z.array(z.json()),
    unknownPriceCalls: z.number().int().nonnegative().safe(),
    callCount: z.number().int().positive().safe(),
    elapsedMs: z.number().nonnegative().finite(),
  }).passthrough(),
  calls: z.array(z.object({
    id,
    purpose: z.string().min(1),
    nativePurpose: z.string().min(1).optional(),
    candidateId: id,
    status: z.string().min(1),
    usage: z.json().nullable(),
    cost: z.json(),
  }).strict()).min(1),
}).strict();

const candidateCaptureSchema = z.object({
  candidateId: id,
  identity: z.object({
    connectionId: id,
    accountId: id,
    billingPath: id,
    provider: id,
    model: id,
  }).strict(),
  registryEpoch: z.number().int().positive().safe(),
  connectionConfigRevision: z.number().int().positive().safe(),
  authEpoch: z.number().int().positive().safe(),
  enabled: z.literal(true),
}).passthrough();

const detectionLaunchSchema = z.object({ taskId: id }).strict();

class DeepSeekUiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DeepSeekUiError';
    this.code = code;
  }
}

function invalidRequest() {
  return new DeepSeekUiError('DEEPSEEK_UI_REQUEST_INVALID', 'DeepSeek request is invalid');
}

function operationFailed() {
  return new DeepSeekUiError('DEEPSEEK_UI_OPERATION_FAILED', 'DeepSeek operation failed');
}

function parseRequest(name, value) {
  const parsed = requests[name].safeParse(value);
  if (!parsed.success) throw invalidRequest();
  return parsed.data;
}

async function call(callback, input, outputSchema) {
  try {
    const value = await callback(input);
    return outputSchema ? outputSchema.parse(value) : value;
  } catch {
    throw operationFailed();
  }
}

function resolveDetectionCandidate(snapshot, candidateId) {
  const candidateSnapshot = candidateSnapshotSchema.parse(snapshot?.candidateSnapshot);
  const { candidates } = candidateSnapshot;
  const candidate = candidates.find(item => item.candidateId === candidateId);
  if (!candidate
    || candidate.ownership !== 'router-owned'
    || candidate.source !== 'deepseek-official-api'
    || candidate.availability.status !== 'available'
    || candidate.routerAuthorization.status !== 'enabled') {
    throw new TypeError('Detection candidate is not an enabled DeepSeek owned route');
  }
  assertDeepSeekModelId(candidate.identity.model);
  return { candidate, snapshotEpoch: candidateSnapshot.snapshotEpoch };
}

function resolveCandidateCapture(value, resolved) {
  const capture = candidateCaptureSchema.parse(value);
  const { candidate, snapshotEpoch } = resolved;
  if (capture.candidateId !== candidate.candidateId
    || !sameIdentity(capture.identity, candidate.identity)
    || capture.authEpoch !== candidate.authEpoch
    || capture.connectionConfigRevision !== candidate.connectionConfigRevision
    || capture.registryEpoch < snapshotEpoch) {
    throw new TypeError('Host capture does not match the resolved detection candidate');
  }
  return capture;
}

function taskIds(snapshot) {
  if (!Array.isArray(snapshot?.tasks)) throw new TypeError('Router Task snapshot is unavailable');
  const ids = snapshot.tasks.map(task => id.parse(task?.id));
  if (new Set(ids).size !== ids.length) throw new TypeError('Router Task snapshot contains duplicate identities');
  return new Set(ids);
}

function freshTask(snapshot, taskId, priorTaskIds) {
  if (priorTaskIds.has(taskId) || !Array.isArray(snapshot?.tasks)) {
    throw new TypeError('Detection did not create a new Router Task');
  }
  const matches = snapshot.tasks.filter(task => task?.id === taskId);
  if (matches.length !== 1) throw new TypeError('Detection Task is absent or ambiguous');
  return matches[0];
}

function detectionView(task, request, capture) {
  if (!Array.isArray(task?.calls) || task.calls.length === 0) {
    throw new TypeError('Detection Task has no accounted Calls');
  }
  for (const item of task.calls) {
    const captured = item?.selectionSnapshot;
    if (item?.candidateId !== capture.candidateId
      || captured?.candidateId !== capture.candidateId
      || !sameIdentity(item.selection, capture.identity)
      || !sameIdentity(captured?.identity, capture.identity)
      || !Number.isSafeInteger(captured?.registryEpoch)
      || captured.registryEpoch < capture.registryEpoch
      || captured?.authEpoch !== capture.authEpoch
      || captured?.connectionConfigRevision !== capture.connectionConfigRevision) {
      throw new TypeError('Detection Call does not use the resolved candidate snapshot');
    }
  }
  const view = {
    taskId: task?.id,
    lifecycle: task?.lifecycle,
    result: typeof task?.result === 'string' ? task.result : '',
    budget: task?.budget?.limits,
    ledger: task?.ledger,
    calls: Array.isArray(task?.calls) ? task.calls.map(item => ({
      id: item.id,
      purpose: item.purpose,
      ...(item.nativePurpose === undefined ? {} : { nativePurpose: item.nativePurpose }),
      candidateId: item.candidateId,
      status: item.status,
      usage: item.usage ?? null,
      cost: item.cost ?? { amount: null, reason: 'UNKNOWN' },
    })) : [],
  };
  const parsed = detectionViewSchema.parse(view);
  if (parsed.budget.tokens !== request.budget.tokens || parsed.budget.durationMs !== request.budget.durationMs) {
    throw new TypeError('Detection Task did not use its requested finite budget');
  }
  if (parsed.ledger.callCount !== parsed.calls.length || parsed.calls.some(call => call.candidateId !== capture.candidateId)) {
    throw new TypeError('Detection Task accounting does not match its owned candidate');
  }
  return parsed;
}

/** Safe callback seam used until the shared Remote facade owns final wiring. */
export function createDeepSeekUiService(callbacks) {
  for (const name of ['snapshot', 'routerSnapshot', 'captureCandidate', 'saveCredential', 'discoverCatalog', 'connect', 'disconnect', 'runDetection']) {
    if (typeof callbacks?.[name] !== 'function') throw new TypeError(`DeepSeek UI callback ${name} is required`);
  }
  return Object.freeze({
    snapshot: () => call(callbacks.snapshot, undefined, deepSeekUiSnapshotSchema),
    routerSnapshot: () => call(callbacks.routerSnapshot),
    saveCredential: value => call(callbacks.saveCredential, parseRequest('saveCredential', value), bindingSchema),
    discoverCatalog: () => call(callbacks.discoverCatalog, undefined, catalogSchema),
    connect: value => call(callbacks.connect, parseRequest('connect', value), connectionSchema),
    disconnect: value => call(callbacks.disconnect, parseRequest('disconnect', value)),
    async runDetection(value) {
      const request = parseRequest('runDetection', value);
      try {
        const before = await callbacks.routerSnapshot();
        const resolved = resolveDetectionCandidate(before, request.candidateId);
        const priorTaskIds = taskIds(before);
        const capture = resolveCandidateCapture(await callbacks.captureCandidate(request.candidateId), resolved);
        const launch = detectionLaunchSchema.parse(await callbacks.runDetection({ ...request, selectionSnapshot: capture }));
        const task = freshTask(await callbacks.routerSnapshot(), launch.taskId, priorTaskIds);
        return detectionView(task, request, capture);
      } catch (error) {
        if (error instanceof DeepSeekUiError) throw error;
        throw operationFailed();
      }
    },
  });
}
