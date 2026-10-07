const SOURCE_DECLARATION = /^研究来源：论点「([^」]+)」引用来源「([^」]+)」中的引文「([^」]+)」。?$/u;

/**
 * Parses the finite research citation syntax while preserving an indexable view
 * of the complete artifact. Citation declarations are masked, not removed, so
 * their own claim text cannot satisfy artifact-claim evidence and every match
 * still maps to the original artifact's UTF-16 and Unicode-code-point offsets.
 */
export function parseResearchArtifact(text, maxSourceReferences = 0) {
  if (typeof text !== 'string') return { sources: [], searchableText: '', referenceLimitExceeded: false };
  const sources = [];
  const searchable = [];
  let referenceLimitExceeded = false;
  let line = 0;
  for (const match of text.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/gu)) {
    const [whole, raw, ending] = match;
    if (whole === '') break;
    const source = raw.trim().match(SOURCE_DECLARATION);
    if (source) {
      searchable.push(' '.repeat([...raw].length), ending);
      if (sources.length < maxSourceReferences) {
        sources.push({ claim: source[1], url: source[2], quote: source[3], line });
      } else {
        referenceLimitExceeded = true;
      }
    } else {
      searchable.push(raw, ending);
    }
    line += 1;
  }
  return { sources, searchableText: searchable.join(''), referenceLimitExceeded };
}

export function locateArtifactClaim(text, claim) {
  if (typeof text !== 'string' || typeof claim !== 'string' || claim.length === 0) return null;
  const { searchableText } = parseResearchArtifact(text);
  const searchable = [...searchableText];
  const expected = [...claim];
  let start = -1;
  outer: for (let index = 0; index <= searchable.length - expected.length; index += 1) {
    for (let offset = 0; offset < expected.length; offset += 1) {
      if (searchable[index + offset] !== expected[offset]) continue outer;
    }
    start = index;
    break;
  }
  if (start < 0) return null;
  return {
    kind: 'unicode-code-points',
    start,
    end: start + expected.length,
  };
}

export function artifactClaimMatches(text, claim, locator) {
  if (typeof text !== 'string' || typeof claim !== 'string' || !locator) return false;
  const { searchableText } = parseResearchArtifact(text);
  return [...searchableText].slice(locator.start, locator.end).join('') === claim
    && [...text].slice(locator.start, locator.end).join('') === claim;
}
