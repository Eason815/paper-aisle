import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { projectLibrary, validateBatch, validateGuideEvidence, resumePlan, identityKeys, buildProgress } from '../scripts/research-core.mjs';

const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const baseBatch = read('../data/batches/batch-001.research.json');
const baseGuides = read('../data/guides/batch-001.json');
const library = read('../public/data/papers.json');
const config = read('../data/research-import.json');
config.defaultCollectionId = config.batches[0].collection.id;
const schemas = { researchSchema: read('../docs/ingestion/research-batch.schema.json'), guidesSchema: read('../docs/ingestion/guides.schema.json') };
const input = (batch = baseBatch, guides = baseGuides) => ({ batch, guides, input: config.batches[0], sha256: 'fixture' });

describe('batch workflow safety', () => {
  it('accepts arbitrary batch sizes and unknown tracks without requiring human confirmation', () => {
    const batch = structuredClone(baseBatch); batch.records = batch.records.slice(0, 3);
    batch.records[0].verification.track = 'unknown'; batch.records[0].verification.trackVerified = false;
    const ids = new Set(batch.records.map(r => r.paper.id));
    const guides = Object.fromEntries(Object.entries(baseGuides).filter(([id]) => ids.has(id)));
    const result = validateBatch(batch, guides, schemas);
    expect(result.errors).toEqual([]); expect(result.warnings.length).toBeGreaterThan(0);
  });
  it('blocks broken evidence and private state', () => {
    const batch = structuredClone(baseBatch);
    batch.records[0].aiSummary.basis.problem = ['nonexistent'];
    batch.records[1].aiSummary.note = 'private note';
    expect(validateBatch(batch, baseGuides, schemas).errors.length).toBeGreaterThan(0);
    delete batch.records[1].aiSummary.note;
    expect(validateBatch(batch, baseGuides, schemas).errors.some(e => e.includes('supports'))).toBe(true);
  });
  it('rejects missing diagram-node evidence mappings', () => {
    const id = baseBatch.records[0].paper.id;
    const evidence = baseBatch.records[0].evidence[1].id;
    const mapping = { [id]: { headline: [evidence], diagramTitle: [evidence], caption: [evidence], nodes: {} } };
    expect(validateGuideEvidence(baseBatch, { [id]: baseGuides[id] }, mapping).some(e => e.includes('nodes'))).toBe(true);
  });
  it('blocks fabricated human confirmation and fulltext diagrams on Abstract import path', () => {
    const batch = structuredClone(baseBatch);
    batch.records[0].verification.humanConfirmed = true;
    batch.records[0].verification.sourceLevel = 'fulltext';
    expect(validateBatch(batch, baseGuides, schemas).errors.some(e => e.includes('人工确认'))).toBe(true);
    expect(() => projectLibrary(library, config, [input(batch)])).toThrow(/全文/);
  });
  it('reimport is idempotent and preserves history and stable identifiers', () => {
    const once = projectLibrary(library, config, [input()]);
    const twice = projectLibrary(once.library, config, [input()]);
    expect(twice.report.added).toEqual([]); expect(twice.report.updated).toEqual([]);
    expect(twice.library).toEqual(once.library);
    expect(once.library.datasetId).toBe(library.datasetId);
    const imported = new Set(baseBatch.records.map(r => r.paper.id));
    for (const p of library.papers.filter(p => !imported.has(p.id))) expect(once.library.papers.find(x => x.id === p.id)).toEqual(p);
  });
  it('preserves every configured batch collection across repeated imports', () => {
    const inputs = config.batches.map(item => ({ input: item, batch: read(`../${item.path}`), guides: read(`../${item.guidesPath}`), sha256: 'fixture' }));
    const projected = projectLibrary(library, config, inputs).library;
    for (const item of inputs) expect(projected.collections.find(c => c.id === item.input.collection.id).paperIds).toEqual(item.batch.records.map(r => r.paper.id));
    expect(projected.collections.find(c => c.id === config.legacyCollection.id).paperIds).toHaveLength(12);
  });
  it('refuses cross-batch duplicate IDs and version aliases with different IDs', () => {
    expect(() => projectLibrary(library, config, [input(), input()])).toThrow(/重复/);
    const batch = structuredClone(baseBatch); const record = batch.records[0];
    record.paper.id = 'different-id'; record.paper.title = 'A revised title for the same work';
    expect(() => projectLibrary(library, config, [input(batch, {})])).toThrow(/持久标识/);
    expect(identityKeys({ id: 'a', links: { official: 'https://arxiv.org/abs/2210.03629v3' } })).toContain('arxiv:2210.03629');
  });
  it('resumes saved items and identifies corrupt claimed completions', () => {
    const id = baseBatch.records[0].paper.id;
    const plan = resumePlan({ batchId: baseBatch.batchId, completedIds: [id, 'missing'], pending: [id, 'new'] }, baseBatch);
    expect(plan.completedIds).toEqual([id]); expect(plan.repairIds).toEqual(['missing']); expect(plan.pending).toEqual(['new']);
    const corrupt = structuredClone(baseBatch);
    corrupt.records[0].aiSummary.basis.problem = ['broken-reference'];
    expect(resumePlan({ batchId: corrupt.batchId, completedIds: [id] }, corrupt).repairIds).toEqual([id]);
  });
  it('does not infer user reading progress from generated records', () => {
    const progress = buildProgress({ scope: {}, target: 60, readerProgress: { reportedReadCount: 10, source: 'user report' } }, [input()]);
    expect(progress.readableRecordCount).toBe(10); expect(progress.humanConfirmedCount).toBe(0);
    expect(progress.readerProgress).not.toHaveProperty('reportedReadCount');
    expect(progress.readerProgress.storage).toContain('.research-private/');
  });
  it('skips excluded metadata safely rather than crashing the source summary', () => {
    const batch = structuredClone(baseBatch); batch.records[0].review.decision = 'excluded';
    delete batch.records[0].paper.links;
    expect(projectLibrary(library, config, [input(batch)]).report.skipped).toContain(batch.records[0].paper.id);
  });
});
