import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { HarnessError } from '@deepseek-ai/dsh-llm';

const TOOL_NAME = 'router_acceptance_program_check';
const MAX_FILES = 2_000;
const MAX_INPUT_BYTES = 32 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const TIMEOUT_MS = 120_000;
const SOURCE_EXTENSIONS = /\.(?:cjs|js|json|mjs)$/iu;
const IGNORED_DIRECTORIES = new Set(['.git', '.router', 'node_modules']);
const digest = value => createHash('sha256').update(value).digest('hex');
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const inside = (workspace, path) => {
  const child = relative(resolve(workspace), resolve(path));
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
};
const failure = (message, code) => new HarnessError(message, code);

async function scopeFiles(workspace) {
  const found = [];
  const pending = [workspace];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) pending.push(path);
        continue;
      }
      if (entry.isFile() && SOURCE_EXTENSIONS.test(entry.name)) found.push(path);
      if (found.length > MAX_FILES) throw failure('Program check scope contains too many files', 'CHECK_SCOPE_TOO_LARGE');
    }
  }
  return found.sort((left, right) => relative(workspace, left).localeCompare(relative(workspace, right)));
}

async function snapshotScope(workspace, paths) {
  let bytes = 0;
  const entries = [];
  for (const path of paths) {
    if (!inside(workspace, path)) throw failure('Program check scope escapes its workspace', 'CHECK_SCOPE_INVALID');
    const content = await readFile(path);
    bytes += content.length;
    if (bytes > MAX_INPUT_BYTES) throw failure('Program check scope is too large', 'CHECK_SCOPE_TOO_LARGE');
    entries.push({ path: relative(workspace, path).split(sep).join('/'), bytes: content.length, hash: digest(content) });
  }
  return { hash: digest(JSON.stringify(entries)), entries };
}

function safeEnvironment() {
  const result = {};
  for (const key of ['APPDATA', 'ComSpec', 'HOME', 'LOCALAPPDATA', 'PATH', 'PATHEXT', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE', 'WINDIR']) {
    if (typeof process.env[key] === 'string') result[key] = process.env[key];
  }
  return result;
}

function runNode(workspace, args, signal) {
  return new Promise((resolveResult, reject) => {
    signal.throwIfAborted();
    const child = spawn(process.execPath, args, { cwd: workspace, env: safeEnvironment(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = Buffer.alloc(0);
    let overflow = false;
    let timedOut = false;
    const append = chunk => {
      if (overflow) return;
      const next = Buffer.concat([output, chunk]);
      if (next.length > MAX_OUTPUT_BYTES) {
        overflow = true;
        child.kill();
      } else output = next;
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const abort = () => child.kill();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, TIMEOUT_MS);
    child.once('error', reject);
    child.once('close', exitCode => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (signal.aborted) return reject(signal.reason ?? failure('Program check canceled', 'ABORTED'));
      if (timedOut) return reject(failure('Program check timed out', 'CHECK_TIMEOUT'));
      if (overflow) return reject(failure('Program check output is too large', 'CHECK_OUTPUT_TOO_LARGE'));
      if (!Number.isSafeInteger(exitCode) || exitCode < 0) return reject(failure('Program check did not report an exit code', 'CHECK_PROCESS_FAILED'));
      resolveResult({ exitCode, outputHash: digest(output) });
    });
  });
}

function toolOutputSchema() {
  const digestSchema = { type: 'string' };
  const artifactRef = {
    type: 'object', additionalProperties: false,
    properties: {
      kind: { type: 'string', const: 'workspace-file' }, path: { type: 'string' }, hash: digestSchema, revision: { type: 'integer' },
      scope: { type: 'object', additionalProperties: false, properties: { workspace: { type: 'string' }, paths: { type: 'array', items: { type: 'string' } } }, required: ['workspace', 'paths'] },
    },
    required: ['kind', 'path', 'hash', 'revision', 'scope'],
  };
  return {
    type: 'object', additionalProperties: false,
    properties: {
      planId: { type: 'string' }, outcome: { type: 'string', enum: ['passed', 'failed'] }, evidenceRef: { type: 'string' }, artifactRef,
      execution: { type: 'object', additionalProperties: false, properties: { planVersion: { type: 'integer' }, commandId: { type: 'string' }, inputHash: digestSchema, exitCode: { type: 'integer' }, outputHash: digestSchema }, required: ['planVersion', 'commandId', 'inputHash', 'exitCode', 'outputHash'] },
    },
    required: ['planId', 'outcome', 'evidenceRef', 'artifactRef', 'execution'],
  };
}

/** Host-only Node project checker. Commands are fixed; model/user text can only name the published plan IDs. */
export function createNodeProgramChecks(ctx, { resolveArtifact } = {}) {
  if (typeof resolveArtifact !== 'function') throw new TypeError('A Host artifact resolver is required');
  const prepared = new Map();
  const unregister = ctx.tools.register({
    name: TOOL_NAME,
    description: 'Run one Host-authorized, fixed Node project acceptance check',
    parameters: { type: 'object', properties: { executionId: { type: 'string' } }, required: ['executionId'], additionalProperties: false },
    output: { schema: toolOutputSchema(), render: (_args, value) => [{ type: 'text', text: `${value.planId}: ${value.outcome}` }] },
    async execute({ executionId }, exec) {
      const plan = prepared.get(executionId);
      prepared.delete(executionId);
      if (!plan) throw failure('Program check plan is unavailable or already consumed', 'CHECK_PLAN_UNAVAILABLE');
      const beforePaths = plan.mode === 'test' ? await scopeFiles(plan.workspace) : [plan.artifactRef.path];
      const before = await snapshotScope(plan.workspace, beforePaths);
      if (before.hash !== plan.inputHash) throw failure('Program check inputs changed before execution', 'CHECK_INPUT_CHANGED');
      const args = plan.mode === 'test' ? ['--test'] : ['--check', plan.artifactRef.path];
      const execution = await runNode(plan.workspace, args, exec.signal);
      const afterPaths = plan.mode === 'test' ? await scopeFiles(plan.workspace) : [plan.artifactRef.path];
      const after = await snapshotScope(plan.workspace, afterPaths);
      if (after.hash !== plan.inputHash) throw failure('Program check inputs changed during execution', 'CHECK_INPUT_CHANGED');
      return {
        planId: plan.planId,
        outcome: execution.exitCode === 0 ? 'passed' : 'failed',
        evidenceRef: `tool-result:v1:${plan.planId}:${digest(`${plan.inputHash}\0${execution.exitCode}\0${execution.outputHash}`)}`,
        artifactRef: plan.artifactRef,
        execution: { planVersion: 1, commandId: plan.commandId, inputHash: plan.inputHash, exitCode: execution.exitCode, outputHash: execution.outputHash },
      };
    },
  });

  const resolvePlan = async ({ task, requirement, artifact, agent, signal }) => {
    signal.throwIfAborted();
    const mode = requirement.planId === 'node-test' && ['behavior', 'test'].includes(requirement.checkKind) ? 'test'
      : requirement.planId === 'node-check' && requirement.checkKind === 'build' ? 'check' : null;
    if (!mode || requirement.origin?.kind !== 'user-message' || typeof requirement.origin.messageId !== 'string') return null;
    const resolvedArtifact = await resolveArtifact({ task, requirement, artifact, agent, signal });
    signal.throwIfAborted();
    const workspace = resolve(resolvedArtifact?.workspace ?? '');
    const path = resolve(resolvedArtifact?.path ?? '');
    if (!isAbsolute(resolvedArtifact?.workspace) || !isAbsolute(resolvedArtifact?.path) || !inside(workspace, path) || !positiveInteger(resolvedArtifact?.revision)) return null;
    const workspaceInfo = await stat(workspace);
    const artifactInfo = await stat(path);
    if (!workspaceInfo.isDirectory() || !artifactInfo.isFile() || !/\.(?:cjs|js|mjs)$/iu.test(path)) return null;
    const paths = mode === 'test' ? await scopeFiles(workspace) : [path];
    if (!paths.some(item => resolve(item) === path)) paths.push(path);
    paths.sort((left, right) => relative(workspace, left).localeCompare(relative(workspace, right)));
    const snapshot = await snapshotScope(workspace, paths);
    const artifactHash = digest(await readFile(path));
    const artifactRef = { kind: 'workspace-file', path, hash: artifactHash, revision: resolvedArtifact.revision, scope: { workspace, paths } };
    const executionId = randomUUID();
    const commandId = mode === 'test' ? 'node-test-workspace-v1' : 'node-check-file-v1';
    prepared.set(executionId, { planId: requirement.planId, mode, workspace, artifactRef, inputHash: snapshot.hash, commandId });
    return {
      authorized: true,
      kind: requirement.checkKind,
      toolName: TOOL_NAME,
      arguments: { executionId },
      authorizationRef: `user-requirement:v1:${requirement.origin.messageId}:${requirement.id}`,
      artifactRef,
      inputHash: snapshot.hash,
      version: 1,
      commandId,
    };
  };

  return Object.freeze({ checks: Object.freeze({ resolvePlan }), dispose() { prepared.clear(); unregister(); } });
}
