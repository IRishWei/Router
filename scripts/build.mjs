import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
await mkdir('lib', { recursive: true });
await mkdir('artifacts', { recursive: true });
const host = (await readFile('src/index.mjs', 'utf8')).replace("'./protocol.mjs'", "'./protocol.js'").replace("'./ledger.mjs'", "'./ledger.js'");
await writeFile('lib/index.js', host);
await writeFile('lib/ledger.js', await readFile('src/ledger.mjs', 'utf8'));
const protocol = await readFile('src/protocol.mjs', 'utf8');
await writeFile('lib/protocol.js', protocol);
await writeFile('lib/typert.host.js', "export { TYPERT, TYPERT as default } from './protocol.js';\n");
await writeFile('lib/typert.remote-client.js', "export { TYPERT_REMOTE, TYPERT_REMOTE as default } from './protocol.js';\n");
// Bundle the codec only. The host's ModuleLoader supplies React and the Cordis runtime.
const inline = protocol.replace("import { z } from 'zod';", '').replaceAll('export const ', 'const ');
const client = (await readFile('src/client.js', 'utf8')).replace('const descriptors = __ROUTER_REMOTE_DESCRIPTORS__;', `${inline}\nconst remoteDescriptors = descriptors;`).replace('package: \'@irishwei/dsh-router\', descriptors }),', 'package: \'@irishwei/dsh-router\', descriptors: remoteDescriptors }),');
await build({ stdin: { contents: `import { z } from 'zod';\n${client}`, resolveDir: process.cwd() }, outfile: 'lib/client.js', bundle: true, platform: 'browser', format: 'iife', target: 'es2022', minify: true });
