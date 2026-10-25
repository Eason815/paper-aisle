import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { validateBatch, validateGuideEvidence, projectLibrary, buildProgress, resumePlan, schemaChecker } from './research-core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = async p => JSON.parse((await readFile(resolve(root, p), 'utf8')).replace(/^\uFEFF/, ''));
const config = await read('data/research-import.json');
const library = await read('public/data/papers.json');
const researchSchema = await read('docs/ingestion/research-batch.schema.json');
const guidesSchema = await read('docs/ingestion/guides.schema.json');
const inputs = [];
for (const input of config.batches) {
  inputs.push({ input, batch: await read(input.path), guides: await read(input.guidesPath), sha256: createHash('sha256').update(await readFile(resolve(root, input.path))).digest('hex') });
}
const flag = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
if (flag('--batch')) {
  if (!flag('--guides')) throw new Error('--batch需要同时提供--guides');
  const batch = await read(flag('--batch')), guides = await read(flag('--guides'));
  const index = inputs.findIndex(x => x.batch.batchId === batch.batchId);
  const input = index >= 0 ? { ...inputs[index].input, path: flag('--batch'), guidesPath: flag('--guides') }
    : { path: flag('--batch'), guidesPath: flag('--guides'), collection: { id: `validation-${batch.batchId}`, name: '校验预览' } };
  const item = { input, batch, guides, sha256: createHash('sha256').update(await readFile(resolve(root, input.path))).digest('hex') };
  if (index >= 0) inputs[index] = item; else inputs.push(item);
}
const errors = [], warnings = [];
for (const item of inputs) {
  let baseline = [];
  try { baseline = JSON.parse(execFileSync('git', ['show', `HEAD:${item.input.path}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).records; } catch {}
  const checked = validateBatch(item.batch, item.guides, { researchSchema, guidesSchema, baseline, questionCatalog: library.questionCatalog });
  errors.push(...checked.errors); warnings.push(...checked.warnings);
  try { errors.push(...validateGuideEvidence(item.batch, item.guides, await read(`data/incoming/${item.batch.batchId}/${item.batch.batchId}.guide-evidence.json`))); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    if (baseline.length) warnings.push(`${item.batch.batchId}: 历史导读无机器映射；保留原检查报告`);
    else errors.push(`${item.batch.batchId}: 新批次缺guide-evidence映射`);
  }
}
let projected;
try { projected = projectLibrary(library, config, inputs); }
catch (e) { errors.push(e.message); }
if (projected) {
  const validate = schemaChecker(await read('public/data/papers.schema.json'));
  if (!validate(projected.library)) errors.push(...validate.errors.map(e => `website${e.instancePath}: ${e.message}`));
}
if (errors.length) { console.error(JSON.stringify({ status: 'fail', errors, warnings }, null, 2)); process.exit(1); }
const command = process.argv[2] ?? 'validate';
if (command === 'validate') console.log(JSON.stringify({ status: 'pass', batchCount: inputs.length, recordCount: inputs.reduce((n, x) => n + x.batch.records.length, 0), warnings, boundary: '结构、跨字段、身份和投影检查；不代替原文语义核查。' }, null, 2));
else if (['status', 'sync'].includes(command)) {
  const checkpoints = [];
  for (const entry of await readdir(join(root, 'data/incoming'), { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    try { checkpoints.push(await read(`data/incoming/${entry.name}/${entry.name}.checkpoint.json`)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  const state = buildProgress(await read('data/research-workflow.json'), inputs, checkpoints);
  if (command === 'sync') {
    await writeFile(join(root, 'data/research-progress.json'), JSON.stringify(state, null, 2) + '\n');
    const lines = ['# Stage 01 问题地图与覆盖', '', state.note, '', `已制作可读记录：${state.readableRecordCount}。用户阅读进度：${JSON.stringify(state.readerProgress)}。`, '', '| 问题 | 当前阅读池篇数 |', '|---|---:|', ...library.questionCatalog.map(q => `| ${q.id} ${q.name} | ${state.questionCoverage[q.id] ?? 0} |`), '', '这是覆盖与补检索清单，不是热点排行。30篇时复盘方法差异与缺口；50篇检查是否足够，默认约60篇，最多70篇。', '未提供用户导出笔记，因此不推断兴趣、不生成用户阅读总结。', ''];
    await writeFile(join(root, 'data/research-map.md'), lines.join('\n'));
  }
  console.log(JSON.stringify(state, null, 2));
} else if (command === 'resume') {
  const dir = process.argv[3];
  if (!dir) throw new Error('需要batch目录');
  const id = dir.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1);
  console.log(JSON.stringify(resumePlan(await read(`${dir}/${id}.checkpoint.json`), await read(`${dir}/${id}.research.json`)), null, 2));
} else throw new Error('支持命令: validate / status / sync / resume');
