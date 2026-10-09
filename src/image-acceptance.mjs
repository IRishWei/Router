import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const digest = value => createHash('sha256').update(value).digest('hex');
const id = (kind, value) => `${kind}:v1:${digest(value).slice(0, 24)}`;
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const OPERATIONS = { 识别: 'recognition', 定位: 'localization', 解释: 'explanation' };
const LIMITS = { inputBytes: 32768, artifactBytes: 262144, images: 16, requirements: 32 };
const LIMITATIONS = ['finite-explicit-image-dsl', 'reference-answers-are-user-declared', 'no-overall-vision-quality-guarantee', 'image-review-uses-provider-declared-token-estimate'];
const ARTIFACT_KEYS = ['id', 'version', 'revision', 'kind', 'sessionId', 'turn', 'step', 'messageId', 'seq', 'hash', 'complete'];
const artifactRecord = artifact => artifact ? Object.fromEntries(ARTIFACT_KEYS.filter(key => artifact[key] !== undefined).map(key => [key, structuredClone(artifact[key])])) : null;
const inputOrigin = input => ({ kind: 'user-message', messageId: input.messageId, requestId: input.requestId ?? null, seq: input.seq ?? null });
const validImage = ref => /^sha256:[a-f0-9]{64}$/u.test(ref?.attachmentId ?? '') && MEDIA_TYPES.has(ref.mediaType) && ['bytes', 'width', 'height'].every(key => Number.isSafeInteger(ref[key]) && ref[key] > 0);
const clauses = text => {
  const values = [];
  let current = '';
  let quoted = false;
  for (const character of text) {
    if (character === '「') quoted = true;
    if (character === '」') quoted = false;
    if (!quoted && (character === '\n' || character === '。')) {
      if (current.trim()) values.push(current.trim());
      current = '';
    } else current += character;
  }
  if (current.trim()) values.push(current.trim());
  return values;
};
const imageInputs = inputs => inputs.flatMap(input => (input.images ?? []).map(({ attachment, blockIndex }) => ({
  id: id('image-input', `${input.messageId}:${blockIndex}`), version: 1, attachment: structuredClone(attachment), hash: attachment?.attachmentId?.slice('sha256:'.length) ?? null,
  origin: { ...inputOrigin(input), blockIndex },
}))).map((image, index) => ({ ...image, index: index + 1 }));

function limitedContribution(task, inputs, images, artifact, reason) {
  const input = inputs.find(input => input.text.includes('仅检查以下图像要求：'));
  const requirement = { id: id('requirement', `${task.id}:image-limit:${reason}`), version: 1, kind: 'image-unresolved', imageIndex: null, imageId: null, operation: null, question: null, description: '图像验收超过固定处理限制。', required: true, origin: { ...inputOrigin(input), clause: 0 } };
  const evidence = { id: id('evidence', `${requirement.id}:interpretation`), version: 1, requirementId: requirement.id, artifactHash: artifact?.hash ?? null, imageId: null, aspect: 'requirement-interpretation', verdict: 'unconfirmed', source: { kind: 'deterministic-rule', rule: 'finite-image-contract-limit', checkerVersion: 1 }, reason };
  return { version: 1, schemaVersion: 1, domain: 'image', taskId: task.id, artifact: artifactRecord(artifact), images, requirements: [requirement], evidence: [evidence], reviewCases: [], limitations: [...LIMITATIONS] };
}

function contribute({ task, inputs, artifact, signal }) {
  const images = imageInputs(inputs);
  if (inputs.some(input => input.text.includes('仅检查以下图像要求：'))) {
    if (inputs.reduce((sum, input) => sum + Buffer.byteLength(input.text, 'utf8'), 0) > LIMITS.inputBytes) return limitedContribution(task, inputs, images, artifact, 'IMAGE_INPUT_LIMIT_EXCEEDED');
    if (Buffer.byteLength(artifact?.text ?? '', 'utf8') > LIMITS.artifactBytes) return limitedContribution(task, inputs, images, artifact, 'IMAGE_ARTIFACT_LIMIT_EXCEEDED');
    if (images.length > LIMITS.images) return limitedContribution(task, inputs, images, artifact, 'IMAGE_COUNT_LIMIT_EXCEEDED');
  }
  const requirements = [];
  const evidence = [];
  const reviewRequirementIds = [];
  const answerClauses = clauses(artifact?.text ?? '').map(clause => clause.match(/^图像([1-9]\d*)(识别|定位|解释)「([^」]+)」答案为「([^」]+)」$/u)).filter(Boolean);
  for (const input of inputs) {
    const marker = '仅检查以下图像要求：';
    const start = input.text.indexOf(marker);
    if (start < 0) continue;
    let body = input.text.slice(start + marker.length);
    for (const otherMarker of ['仅检查以下明确要求：', '仅检查以下研究要求：']) {
      const end = body.indexOf(otherMarker);
      if (end >= 0) body = body.slice(0, end);
    }
    for (const [clauseIndex, clause] of clauses(body).entries()) {
      const reference = clause.match(/^图像([1-9]\d*)(识别|定位|解释)「([^」]+)」的参考答案为「([^」]+)」$/u);
      const ambiguous = clause.match(/^图像([1-9]\d*)(识别|定位|解释)「([^」]+)」存在歧义$/u);
      const rubric = clause.match(/^图像([1-9]\d*)(识别|定位|解释)「([^」]+)」的(高风险)?评审标准为「([^」]+)」$/u);
      const parsed = reference ?? ambiguous ?? rubric;
      const imageIndex = parsed ? Number(parsed[1]) : null;
      const image = images.find(item => item.index === imageIndex);
      const requirement = { id: id('requirement', `${task.id}:${input.messageId}:${clauseIndex}:image`), version: 1, kind: reference ? 'image-reference' : ambiguous ? 'image-ambiguous' : rubric ? 'image-rubric' : 'image-unresolved', imageIndex, imageId: image?.id ?? null, imageHash: image?.hash ?? null, imageInputHash: image ? digest(JSON.stringify(image.attachment)) : null, operation: OPERATIONS[parsed?.[2]] ?? null, question: parsed?.[3] ?? null, ...(reference ? { referenceAnswer: reference[4] } : {}), ...(rubric ? { rubric: rubric[5], risk: rubric[4] ? 'high' : 'standard' } : {}), description: clause, required: true, origin: { ...inputOrigin(input), clause: clauseIndex } };
      requirements.push(requirement);
      const base = { version: 1, requirementId: requirement.id, artifactHash: artifact?.hash ?? null, imageId: image?.id ?? null };
      const bound = image && validImage(image.attachment);
      evidence.push({ ...base, id: id('evidence', `${requirement.id}:image-binding`), aspect: 'image-binding', verdict: bound ? 'passed' : 'unconfirmed', source: { kind: 'host-image-input', checkerVersion: 1 }, ...(bound ? { imageHash: image.hash } : { reason: 'IMAGE_INPUT_MISSING_OR_INVALID' }) });
      if (ambiguous) {
        evidence.push({ ...base, id: id('evidence', `${requirement.id}:answer-match`), aspect: 'answer-match', verdict: 'unconfirmed', source: { kind: 'deterministic-rule', rule: 'ambiguous-image-reference', checkerVersion: 1 }, reason: 'IMAGE_REFERENCE_AMBIGUOUS' });
        continue;
      }
      if (rubric) {
        evidence.push({ ...base, id: id('evidence', `${requirement.id}:explicit-requirement`), aspect: 'explicit-requirement', verdict: 'passed', source: { kind: 'user-rubric', confidence: 'declared' }, rubric: requirement.rubric });
        const answers = answerClauses.filter(answer => Number(answer[1]) === imageIndex && OPERATIONS[answer[2]] === requirement.operation && answer[3] === requirement.question);
        const reviewable = bound && artifact?.complete && !signal?.aborted && answers.length === 1;
        evidence.push({ ...base, id: id('evidence', `${requirement.id}:answer-match`), aspect: 'answer-match', verdict: 'unconfirmed', source: reviewable ? { kind: 'image-review', confidence: 'unconfirmed' } : { kind: 'deterministic-rule', rule: 'image-review-requirement', checkerVersion: 1 }, reason: !bound ? 'IMAGE_INPUT_MISSING_OR_INVALID' : !artifact?.complete ? 'ARTIFACT_INCOMPLETE' : signal?.aborted ? 'CANCELED' : answers.length > 1 ? 'IMAGE_ANSWER_CONFLICT' : !answers.length ? 'IMAGE_ANSWER_MISSING' : 'IMAGE_REVIEW_REQUIRED' });
        if (reviewable) reviewRequirementIds.push(requirement.id);
        continue;
      }
      if (!reference) {
        evidence.push({ ...base, id: id('evidence', `${requirement.id}:interpretation`), aspect: 'requirement-interpretation', verdict: 'unconfirmed', source: { kind: 'deterministic-rule', rule: 'finite-image-dsl', checkerVersion: 1 }, reason: 'IMAGE_REQUIREMENT_UNRESOLVED' });
        continue;
      }
      evidence.push({ ...base, id: id('evidence', `${requirement.id}:reference-answer`), aspect: 'reference-answer', verdict: 'passed', source: { kind: 'user-reference', confidence: 'declared' }, referenceAnswer: reference[4] });
      const answers = answerClauses.filter(answer => Number(answer[1]) === imageIndex && OPERATIONS[answer[2]] === requirement.operation && answer[3] === requirement.question);
      const answer = answers[0]?.[4];
      const complete = artifact?.complete && !signal?.aborted;
      const verdict = !bound || !complete || answers.length > 1 ? 'unconfirmed' : answer === reference[4] ? 'passed' : 'failed';
      evidence.push({ ...base, id: id('evidence', `${requirement.id}:answer-match`), aspect: 'answer-match', verdict, source: { kind: 'deterministic-rule', rule: 'bound-exact-image-answer', checkerVersion: 1 }, ...(answer ? { answer, artifactQuote: answers[0][0] } : {}), ...(!bound ? { reason: 'IMAGE_INPUT_MISSING_OR_INVALID' } : !complete ? { reason: signal?.aborted ? 'CANCELED' : 'ARTIFACT_INCOMPLETE' } : answers.length > 1 ? { reason: 'IMAGE_ANSWER_CONFLICT' } : answer === reference[4] ? {} : { reason: answer ? 'IMAGE_REFERENCE_MISMATCH' : 'IMAGE_ANSWER_MISSING' }) });
    }
  }
  if (requirements.length > LIMITS.requirements) return limitedContribution(task, inputs, images, artifact, 'IMAGE_REQUIREMENT_LIMIT_EXCEEDED');
  for (const requirement of requirements.filter(item => item.kind === 'image-reference')) {
    const related = requirements.filter(item => item.imageId === requirement.imageId && item.imageIndex === requirement.imageIndex && item.operation === requirement.operation && item.question === requirement.question);
    const conflict = new Set(related.filter(item => item.kind === 'image-reference').map(item => item.referenceAnswer)).size > 1;
    const ambiguous = related.some(item => item.kind === 'image-ambiguous');
    if (conflict || ambiguous) {
      const answer = evidence.find(item => item.requirementId === requirement.id && item.aspect === 'answer-match');
      answer.verdict = 'unconfirmed';
      answer.reason = ambiguous ? 'IMAGE_REFERENCE_AMBIGUOUS' : 'IMAGE_REFERENCE_CONFLICT';
    }
  }
  const reviewRequirements = requirements.filter(requirement => reviewRequirementIds.includes(requirement.id));
  const reviewImages = images.filter(image => reviewRequirements.some(requirement => requirement.imageId === image.id));
  const reviewCases = reviewRequirements.length ? [{ id: id('review-case', `${task.id}:${digest(JSON.stringify(reviewRequirements))}`), version: 1, kind: 'image-rubric', risk: reviewRequirements.some(item => item.risk === 'high') ? 'high' : 'standard', requirementIds: reviewRequirements.map(requirement => requirement.id), evidenceIds: evidence.filter(item => reviewRequirementIds.includes(item.requirementId) && item.aspect === 'answer-match').map(item => item.id), imageIds: reviewImages.map(image => image.id), anonymousPayload: { artifact: { text: artifact.text, hash: artifact.hash }, requirements: reviewRequirements.map(({ id, imageId, operation, question, rubric }) => ({ id, imageId, operation, question, rubric })), images: reviewImages.map(({ id, index, hash, attachment }) => ({ id, index, hash, mediaType: attachment.mediaType })) } }] : [];
  return { version: 1, schemaVersion: 1, domain: 'image', taskId: task.id, artifact: artifactRecord(artifact), images, requirements, evidence, reviewCases, limitations: [...LIMITATIONS] };
}

export function createImageAcceptance() { return { contribute }; }

// Host contributors may return evidence only for the exact admitted input and artifact.
export function validateImageContribution(value, { taskId, artifact, inputs, signal }) {
  const expected = contribute({ task: { id: taskId }, artifact, inputs, signal });
  if (!isDeepStrictEqual(value, expected)) throw new TypeError('Image contribution differs from the exact Host input, artifact or finite rule result');
  return structuredClone(value);
}
