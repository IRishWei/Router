import { readFile, writeFile } from 'node:fs/promises';
const path = 'C:/Users/a1500/.codex/worktrees/t18-failure-recovery/Router项目/test/t18.integration.test.mjs';
const source = await readFile(path, 'utf8');
await writeFile(path, source.replaceAll('await rm(home, { recursive: true, force: true });', 'await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });'));
