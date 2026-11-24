import { build } from 'esbuild';
import { readdir,mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
await mkdir('operations/tests',{recursive:true});
const entries=(await readdir('tests')).filter(f=>f.endsWith('.test.ts'));
for(const file of entries)await build({entryPoints:['tests/'+file],outfile:'operations/tests/'+file.replace('.ts','.mjs'),bundle:true,platform:'node',format:'esm',packages:'external',target:'node26'});
const child=spawn(process.execPath,['--test','--test-isolation=none',...entries.map(f=>'operations/tests/'+f.replace('.ts','.mjs'))],{stdio:'inherit'});
child.on('exit',code=>{process.exitCode=code??1;});
