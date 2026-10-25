import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export function schemaChecker(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

export function titleKey(title) {
  return title.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function identityKeys(paper) {
  const keys = new Set([`id:${paper.id}`]);
  for (const value of Object.values(paper.links ?? {})) {
    let url;
    try { url = new URL(value); } catch { continue; }
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const path = url.pathname.replace(/\/$/, '');
    let match;
    if (host === 'arxiv.org' && (match = path.match(/^\/(?:abs|pdf)\/(.+?)(?:v\d+)?(?:\.pdf)?$/))) keys.add(`arxiv:${match[1]}`);
    else if (host === 'openreview.net' && url.searchParams.get('id')) keys.add(`openreview:${url.searchParams.get('id')}`);
    else if (host === 'aclanthology.org' && (match = path.match(/^\/([^/]+?)(?:\.pdf)?$/))) keys.add(`acl:${match[1]}`);
    else if (host === 'proceedings.iclr.cc' && (match = path.match(/\/paper\/(\d+)\/(?:hash|file)\/([a-f0-9]{32})-/))) keys.add(`iclr:${match[1]}:${match[2]}`);
    else if (/^(icml|iclr|neurips)\.cc$/.test(host) && /\/virtual\/\d+\/(?:poster|oral|spotlight)\/\d+$/.test(path)) keys.add(`official:${host}${path}`);
  }
  return [...keys];
}

const privateKeys = new Set(['readingStatus', 'favorite', 'favoritedAt', 'note', 'tags', 'exportedAt']);
export function privacyErrors(value, path = '') {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => [
    ...(privateKeys.has(key) ? [`${path}/${key}: 私人阅读字段不得进入公共批次`] : []),
    ...privacyErrors(item, `${path}/${key}`),
  ]);
}

export function validateBatch(batch, guides, { researchSchema, guidesSchema, baseline = [], questionCatalog = [] } = {}) {
  const errors = [], warnings = [];
  for (const [label, value, schema] of [['research', batch, researchSchema], ['guides', guides, guidesSchema]]) {
    if (!schema) continue;
    const validate = schemaChecker(schema);
    if (!validate(value)) errors.push(...validate.errors.map(e => `${label}${e.instancePath}: ${e.message}`));
  }
  errors.push(...privacyErrors(batch), ...privacyErrors(guides));
  if (!Array.isArray(batch?.records) || errors.length) return { errors, warnings };
  const ids = new Set(), evidenceIds = new Set();
  const questions = new Map((questionCatalog.length ? questionCatalog : batch.questionCatalog).map(q => [q.id, q]));
  for (const q of batch.questionCatalog) {
    if (!questions.has(q.id) || JSON.stringify(questions.get(q.id)) !== JSON.stringify(q)) errors.push(`问题目录冲突: ${q.id}`);
  }
  const before = new Map(baseline.map(r => [r.paper.id, r]));
  for (const record of batch.records) {
    const { paper: p, review, verification: v, aiSummary: s } = record;
    if (ids.has(p.id)) errors.push(`重复论文ID: ${p.id}`);
    ids.add(p.id);
    const old = before.get(p.id);
    if (v.humanConfirmed && !old?.verification.humanConfirmed) errors.push(`${p.id}: 新增人工确认没有输入依据`);
    if (s.humanChecked && !old?.aiSummary.humanChecked) errors.push(`${p.id}: 新增人工速读确认没有输入依据`);
    if ((review.decision === 'included' || review.role || v.confirmedAt) && !old?.verification.humanConfirmed) errors.push(`${p.id}: 不得自动填最终纳入/role/确认时间`);
    if (old?.verification.humanConfirmed && !v.humanConfirmed || old?.aiSummary.humanChecked && !s.humanChecked) errors.push(`${p.id}: 既有人工作出状态被重置`);
    if (review.mainQuestionId && !questions.has(review.mainQuestionId)) errors.push(`${p.id}: 主问题不存在`);
    for (const q of review.secondaryQuestionIds ?? []) if (!questions.has(q) || q === review.mainQuestionId) errors.push(`${p.id}: 次问题无效 ${q}`);
    const evidence = new Map();
    for (const e of record.evidence) {
      if (evidenceIds.has(e.id)) errors.push(`重复证据ID: ${e.id}`);
      evidenceIds.add(e.id); evidence.set(e.id, e);
      try { if (!['http:', 'https:'].includes(new URL(e.url).protocol)) throw new Error(); }
      catch { errors.push(`${p.id}: 无效证据链接 ${e.id}`); }
    }
    for (const part of ['problem', 'finding', 'approach']) {
      if (!s[part]) continue;
      if (!s.basis[part]?.length) errors.push(`${p.id}: ${part} 缺证据引用`);
      for (const id of s.basis[part] ?? []) {
        if (!evidence.get(id)?.supports.includes(`aiSummary.${part}`)) errors.push(`${p.id}: ${part} 的证据不存在或supports不对应: ${id}`);
      }
    }
    if (s.finding && !s.finding.startsWith('论文报告：')) errors.push(`${p.id}: 发现段未区分作者报告`);
    if (v.sourceLevel === 'title' && ['problem', 'finding', 'approach'].some(k => s[k])) errors.push(`${p.id}: 标题级不得制作速读`);
    if (v.sourceLevel === 'fulltext' && !v.readSections?.length) errors.push(`${p.id}: 全文核读缺实际章节`);
    if (!v.trackVerified || v.track === 'unknown') warnings.push(`${p.id}: 轨道未核实；不阻碍泛读`);
    if (!v.humanConfirmed) warnings.push(`${p.id}: 未人工确认；不阻碍泛读`);
    const g = guides[p.id];
    if (!g) warnings.push(`${p.id}: 没有导读`);
    if (g?.diagram) {
      const nodeIds = g.diagram.nodes.map(n => n.id);
      if (new Set(nodeIds).size !== nodeIds.length) errors.push(`${p.id}: 图节点ID重复`);
      if (!g.diagram.caption.includes('概念示意') || !g.diagram.caption.includes('摘要')) errors.push(`${p.id}: 摘要图未标明概念示意与依据范围`);
      if (v.sourceLevel !== 'abstract') errors.push(`${p.id}: 当前图解导入仅支持摘要级，禁止将全文证据标作Abstract`);
    }
  }
  for (const id of Object.keys(guides)) if (!ids.has(id)) errors.push(`导读引用不存在的论文: ${id}`);
  return { errors, warnings };
}

export function projectLibrary(original, config, inputs) {
  const library = structuredClone(original);
  const byId = new Map(library.papers.map(p => [p.id, p]));
  const byTitle = new Map(library.papers.map(p => [titleKey(p.title), p.id]));
  const byIdentity = new Map();
  for (const p of library.papers) for (const k of identityKeys(p)) byIdentity.set(k, p.id);
  const imported = new Set(), collections = [...(library.collections ?? [])];
  const questions = new Map((library.questionCatalog ?? []).map(q => [q.id, q]));
  const report = { added: [], updated: [], unchanged: [], skipped: [], originalCount: library.papers.length, sourceBatches: [] };
  const kindLabels = { method: '方法 / 系统', analysis: '实证分析', benchmark: '评测 / 基准' };
  const sources = [...(library.library.sources ?? [])];
  for (const { batch, guides, input, sha256 } of inputs) {
    report.sourceBatches.push({ batchId: batch.batchId, path: input.path, sha256 });
    for (const q of batch.questionCatalog) {
      if (questions.has(q.id) && JSON.stringify(questions.get(q.id)) !== JSON.stringify(q)) throw new Error(`研究问题编号冲突: ${q.id}`);
      questions.set(q.id, q);
    }
    const memberIds = [];
    for (const record of batch.records) {
      const p = record.paper, s = record.aiSummary, v = record.verification;
      if (record.review.decision === 'excluded' || v.sourceLevel === 'title' || !record.evidence?.length || !s.problem) { report.skipped.push(p.id); continue; }
      if (imported.has(p.id)) throw new Error(`批次内/跨批次ID重复: ${p.id}`);
      imported.add(p.id);
      const titleMatch = byTitle.get(titleKey(p.title));
      if (titleMatch && titleMatch !== p.id) throw new Error(`同名工作需映射ID: ${p.id} / ${titleMatch}`);
      for (const key of identityKeys(p)) if (byIdentity.has(key) && byIdentity.get(key) !== p.id) throw new Error(`同一持久标识冲突: ${p.id} / ${byIdentity.get(key)}`);
      if (byId.has(p.id) && byId.get(p.id).title !== p.title) throw new Error(`论文ID与标题冲突: ${p.id}`);
      if (!p.links?.official || !p.venue) throw new Error(`${p.id}: 可导入记录缺官方来源/venue`);
      const url = new URL(p.links.official);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error(`${p.id}: 来源协议无效`);
      const guide = guides[p.id];
      if (guide && v.sourceLevel !== 'abstract') throw new Error(`${p.id}: 全文导读暂不可进入固定Abstract的转换路径`);
      const projected = { ...p, quickRead: Object.fromEntries(['problem', 'finding', 'approach'].filter(k => s[k]).map(k => [k, s[k]])), questionId: record.review.mainQuestionId, scenarios: record.review.scenarios,
        ...(guide ? { contributionTypes: [kindLabels[guide.kind]], readingGuide: { ...guide, sourceLevel: v.sourceLevel, sources: [{ label: `${p.venue} 官方论文页`, url: p.links.official, locator: 'Abstract' }] } } : {}),
      };
      const merged = { ...byId.get(p.id), ...projected };
      if (!byId.has(p.id)) report.added.push(p.id);
      else if (JSON.stringify(byId.get(p.id)) === JSON.stringify(merged)) report.unchanged.push(p.id);
      else report.updated.push(p.id);
      byId.set(p.id, merged); byTitle.set(titleKey(p.title), p.id);
      for (const k of identityKeys(p)) byIdentity.set(k, p.id);
      memberIds.push(p.id);
      const origin = url.origin + '/';
      if (!sources.some(s => s.url === origin)) sources.push({ label: `${p.venue} 官方论文页`, url: origin });
    }
    const collection = { ...input.collection, paperIds: memberIds };
    const at = collections.findIndex(c => c.id === collection.id);
    if (at >= 0) collections[at] = collection; else collections.unshift(collection);
  }
  const legacyIds = [...byId.keys()].filter(id => !imported.has(id));
  const legacy = { ...config.legacyCollection, paperIds: legacyIds };
  const at = collections.findIndex(c => c.id === legacy.id);
  if (at >= 0) collections[at] = legacy; else collections.push(legacy);
  library.papers = [...byId.values()]; library.collections = collections; library.questionCatalog = [...questions.values()];
  library.config = { ...library.config, defaultCollectionId: config.defaultCollectionId };
  library.library.updatedAt = config.updatedAt; library.library.sources = sources;
  if (!collections.some(c => c.id === config.defaultCollectionId)) throw new Error('默认集合不存在');
  report.finalCount = library.papers.length; report.preservedLegacyCount = legacyIds.length;
  report.defaultCollectionCount = collections.find(c => c.id === config.defaultCollectionId).paperIds.length;
  return { library, report };
}

export function validateGuideEvidence(batch, guides, mapping) {
  const errors = [];
  const records = new Map(batch.records.map(r => [r.paper.id, r]));
  for (const [id, guide] of Object.entries(guides)) {
    const record = records.get(id), map = mapping[id];
    if (!record || !map) { errors.push(`${id}: 缺导读证据映射`); continue; }
    const evidence = new Set(record.evidence.map(e => e.id));
    const check = (refs, field) => {
      if (!Array.isArray(refs) || !refs.length || refs.some(ref => !evidence.has(ref))) errors.push(`${id}: ${field} 证据映射无效`);
    };
    check(map.headline, 'headline');
    if (guide.diagram) {
      check(map.diagramTitle, 'diagram.title'); check(map.caption, 'diagram.caption');
      for (const node of guide.diagram.nodes) check(map.nodes?.[node.id], `diagram.nodes.${node.id}`);
    }
  }
  return errors;
}

export function resumePlan(checkpoint, batch) {
  if (checkpoint.batchId !== batch.batchId) throw new Error('checkpoint批次不匹配');
  const saved = new Set(batch.records.filter(r => {
    try { return r.verification.sourceLevel !== 'title' && r.evidence?.length && r.aiSummary.problem && !validateBatch({ ...batch, records: [r] }, {}, { baseline: [r] }).errors.length; }
    catch { return false; }
  }).map(r => r.paper.id));
  const claimed = checkpoint.completedIds ?? [];
  return { completedIds: claimed.filter(id => saved.has(id)), repairIds: claimed.filter(id => !saved.has(id)), pending: (checkpoint.pending ?? []).filter(item => !saved.has(typeof item === 'string' ? item : item.id)), uncheckpointedSavedIds: [...saved].filter(id => !claimed.includes(id)) };
}

export function buildProgress(config, inputs, checkpoints = []) {
  const records = inputs.flatMap(x => x.batch.records);
  const readable = records.filter(r => r.review.decision !== 'excluded' && r.verification.sourceLevel !== 'title' && r.aiSummary.problem);
  const count = {};
  for (const r of readable) if (r.review.mainQuestionId) count[r.review.mainQuestionId] = (count[r.review.mainQuestionId] ?? 0) + 1;
  return { schemaVersion: 1, scope: config.scope, target: config.target, processedRecordCount: records.length,
    readableRecordCount: readable.length,
    humanConfirmedCount: records.filter(r => r.verification.humanConfirmed).length,
    readerProgress: { storage: '.research-private/reading-progress.json', policy: '个人阅读进度仅保存在本地，不从AI制作数量推断、不写入公共进度。' },
    questionCoverage: count,
    batches: inputs.map(({ batch }) => ({ batchId: batch.batchId, count: batch.records.length, ids: batch.records.map(r => r.paper.id) })),
    unfinishedBatches: checkpoints.filter(c => !['imported', 'published'].includes(c.status)).map(c => ({ batchId: c.batchId, status: c.status, pending: c.pending ?? [], failures: c.failures ?? [] })),
    note: '问题覆盖只描述目的性选取样本；制作数量与用户阅读数量独立。humanConfirmed不作为泛读门槛。',
  };
}
