import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { projectLibrary, validateBatch, validateGuideEvidence, schemaChecker } from './research-core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = async p => JSON.parse((await readFile(resolve(root, p), 'utf8')).replace(/^\uFEFF/, ''));
const config = await read('data/research-import.json');
const original = await read('public/data/papers.json');
const researchSchema = await read('docs/ingestion/research-batch.schema.json');
const guidesSchema = await read('docs/ingestion/guides.schema.json');
const inputs = [];
for (const input of config.batches) {
  const batch = await read(input.path), guides = await read(input.guidesPath);
  // Import never creates human confirmation. Existing recorded states are preserved.
  let baseline = [];
  try { baseline = JSON.parse(execFileSync('git', ['show', `HEAD:${input.path}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).records; } catch {}
  const result = validateBatch(batch, guides, { researchSchema, guidesSchema, baseline, questionCatalog: original.questionCatalog });
  try { result.errors.push(...validateGuideEvidence(batch, guides, await read(`data/incoming/${batch.batchId}/${batch.batchId}.guide-evidence.json`))); }
  catch (e) { if (e.code !== 'ENOENT') throw e; if (!baseline.length) result.errors.push(`${batch.batchId}: 新批次缺导读证据映射`); }
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  inputs.push({ batch, guides, input, sha256: createHash('sha256').update(await readFile(resolve(root, input.path))).digest('hex') });
}
const { library, report } = projectLibrary(original, config, inputs);
const validate = schemaChecker(await read('public/data/papers.schema.json'));
if (!validate(library)) throw new Error(JSON.stringify(validate.errors));
if (process.argv.includes('--write')) {
  await writeFile(resolve(root, 'public/data/papers.json'), JSON.stringify(library, null, 2) + '\n');
  await writeFile(resolve(root, 'data/import-report.json'), JSON.stringify(report, null, 2) + '\n');
  for (const { batch } of inputs) {
    const path = `data/incoming/${batch.batchId}/${batch.batchId}.checkpoint.json`;
    try {
      const checkpoint = await read(path);
      checkpoint.status = 'imported'; checkpoint.nextStep = '完成构建与界面验收，再按本次授权发布并验证线上';
      checkpoint.actualChecks = [...(checkpoint.actualChecks ?? []).filter(c => c.name !== 'schema-and-import'), { name: 'schema-and-import', result: 'pass' }];
      await writeFile(resolve(root, path), JSON.stringify(checkpoint, null, 2) + '\n');
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
console.log(JSON.stringify({ mode: process.argv.includes('--write') ? 'write' : 'dry-run', ...report }, null, 2));
