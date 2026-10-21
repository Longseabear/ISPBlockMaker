
import fs from 'node:fs';
import {runRecipe} from '../server/recipes.mjs';
try {
  const request = JSON.parse(fs.readFileSync(process.env.ISP_RECIPE_REQUEST, 'utf8'));
  console.log('Runs: ' + request.id);
  const result = await runRecipe(process.env.ISP_WORKSPACE, request.id,
    {parameters:request.parameters, expectedHash:request.expectedHash},
    {stdout:chunk=>process.stdout.write(chunk),stderr:chunk=>process.stderr.write(chunk)});
  console.log('\n' + result.status + ' · ' + result.manifestPath);
  process.exitCode = result.status === 'succeeded' ? 0 : 1;
} catch(error) { console.error(error.message); process.exitCode = 1; }
