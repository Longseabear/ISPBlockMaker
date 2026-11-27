
import fs from 'node:fs';
import {runRecipe} from '../server/recipes.mjs';
const controller=new AbortController();
const stop=()=>controller.abort();
const signals=process.platform==='win32'?[]:['SIGHUP','SIGINT','SIGTERM'];
for(const signal of signals)process.on(signal,stop);
try {
  const request = JSON.parse(fs.readFileSync(process.env.ISP_RECIPE_REQUEST, 'utf8'));
  console.log('Runs: ' + request.id);
  const result = await runRecipe(process.env.ISP_WORKSPACE, request.id,
    {parameters:request.parameters, expectedHash:request.expectedHash},
    {signal:controller.signal,stdout:chunk=>process.stdout.write(chunk),stderr:chunk=>process.stderr.write(chunk)});
  console.log('\n' + result.status + ' · ' + result.manifestPath);
  process.exitCode = result.status === 'succeeded' ? 0 : 1;
} catch(error) { console.error(error.message); process.exitCode = 1; }
finally {for(const signal of signals)process.off(signal,stop);}
