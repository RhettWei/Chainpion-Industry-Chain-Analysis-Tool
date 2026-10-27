import test from 'node:test';
import assert from 'node:assert/strict';
import { computeQuant, validateQuant, MODEL_CATALOG } from '../src/models.mjs';
import { computeOperating } from '../src/core.mjs';
import { DEMO_INPUT, DEMO_MARKET_DATA } from '../src/demo.mjs';
const base = model => ({ ...structuredClone(DEMO_INPUT), analysis: { model }, companies: [{ id: 'c', name: '手算企业', role: 'midstream', shockChannel: 'cost', baselineRevenue: 1000, baselineGrossMarginPct: 20, variableCostSharePct: 75, fixedOperatingCost: 100, rawMaterialCostSharePct: 50, evidenceIds: [] }],
  parameters: { shockPct: 10, volumePct: 20, passThroughPct: 40, exposurePct: 60, lagMonths: 3, horizonMonths: 12 } });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
test('legacy cost model preserves every deterministic operating value', () => {
  const original = computeOperating(DEMO_INPUT), next = computeQuant(DEMO_INPUT);
  assert.deepEqual(next.companies, original.companies);
  assert.equal(next.modelId, 'cost_transmission');
  assert.equal(MODEL_CATALOG.length, 4);
});
test('volume-price model requires only its own fields; ignores raw shock, pass-through, exposure and lag', () => {
  const input = base('volume_price'); input.companies[0].rawMaterialCostSharePct = null;
  const result = computeQuant(input), row = result.companies[0];
  assert.equal(validateQuant(input).missing.length, 0);
  near(row.scenario.revenue, 1320); near(row.scenario.cogs, 920); near(row.scenario.grossProfit, 400);
  near(row.delta.grossProfit, 200); near(row.scenario.operatingProfit, 300);
  near(row.bridge.reduce((sum, part) => sum + part.value, 0), row.delta.grossProfit);
  input.parameters.passThroughPct = 0; input.parameters.exposurePct = 0; input.parameters.lagMonths = 36;
  near(computeQuant(input).companies[0].delta.grossProfit, 200);
  assert.deepEqual(result.sensitivity.map(row => row.key), ['shockPct', 'volumePct']);
  assert.deepEqual(Object.keys(result.scenarios[2].parameters), ['shockPct', 'volumePct']);
});
test('CVP has a hand-calculated break-even and counts fixed COGS plus fixed opex once', () => {
  const row = computeQuant(base('break_even')).companies[0];
  near(row.breakEven.fixedCost, 300); near(row.breakEven.variableCost, 600);
  near(row.breakEven.contributionMarginPct, 500 / 1100 * 100);
  near(row.breakEven.revenue, 660); near(row.breakEven.volumeIndex, .6);
  near(row.breakEven.requiredVolumeChangePct, -40); near(row.breakEven.safetyMarginPct, 50);
  near(row.scenario.operatingProfit, 300);
});
test('CVP missing fixed opex stays missing; a true zero is allowed; nonpositive contribution has no fake threshold', () => {
  const input = base('break_even'); input.companies[0].fixedOperatingCost = null;
  assert.ok(validateQuant(input).missing[0].fields.includes('fixedOperatingCost'));
  assert.equal(computeQuant(input).companies[0].status, 'missing');
  input.companies[0].fixedOperatingCost = 0;
  near(computeQuant(input).companies[0].breakEven.revenue, 440);
  input.parameters.shockPct = -60;
  const point = computeQuant(input).companies[0].breakEven;
  assert.equal(point.status, 'no_positive_contribution'); assert.equal(point.revenue, null); assert.equal(point.volumeIndex, null);
});
test('explicit baseline snapshot detects stale periods and values but permits scenario slider changes', () => {
  const input = base('volume_price');
  input.analysis.baselineReview = { confirmedAt: new Date().toISOString(), periodLabel: input.context.periodLabel, fields: ['baselineRevenue', 'baselineGrossMarginPct', 'variableCostSharePct', 'fixedOperatingCost'].map(field => ({ companyId: 'c', field, value: input.companies[0][field], kind: 'user' })) };
  assert.equal(validateQuant(input).valid, true);
  input.parameters.shockPct = 20; assert.equal(validateQuant(input).valid, true);
  input.companies[0].baselineRevenue = 2000; assert.equal(validateQuant(input).valid, false);
  assert.throws(() => computeQuant(input), /重新确认/);
  input.companies[0].baselineRevenue = 1000; input.context.periodLabel = '另一期间';
  assert.equal(validateQuant(input).valid, false);
});
test('CVP sensitivity skips a first company whose required fixed expenses are unknown', () => {
  const input = base('break_even');
  input.companies.push({ ...input.companies[0], id: 'ready', name: '完整企业' });
  input.companies[0].fixedOperatingCost = null;
  const result = computeQuant(input);
  assert.equal(result.companies[0].status, 'missing');
  assert.equal(result.sensitivity[0].companyId, 'ready');
});
test('market model does not require financials and delegates real window math without conflating profits', () => {
  const input = base('event_study'); input.companies[0].baselineRevenue = null;
  assert.equal(validateQuant(input).missing.length, 0);
  const result = computeQuant(input, { marketData: DEMO_MARKET_DATA });
  assert.equal(result.companies.length, 0); assert.equal(result.marketStudy.status, 'available');
  assert.equal(result.marketStudy.series.length, 11); assert.match(result.summary.headline, /CAR/);
});
test('invalid model and incomplete volume-price input produce validation errors, not unchecked crashes', () => {
  assert.equal(validateQuant({ analysis: { model: 'volume_price' } }).valid, false);
  assert.equal(validateQuant({ analysis: { model: 'unknown' } }).valid, false);
  const input = base('volume_price'); input.companies[0].baselineSources = { baselineRevenue: { kind: 'reference', evidenceId: 'absent' } };
  assert.equal(validateQuant(input).valid, false);
});

function routedInput(route = 'materials') {
  const input = base('volume_price');
  input.evidence.push({ id: 'reviewed-source', kind: 'user', title: '测试资料：营业收入', source: '测试财报资料', publishedAt: '2026-09-30' });
  input.companies[0].baselineSources = {
    baselineRevenue: { kind: 'reference', route, evidenceId: 'reviewed-source',
      review: { status: 'approved', reviewedAt: '2026-10-03T09:00:00+08:00', period: input.context.periodLabel } },
  };
  return input;
}
function confirmBaseline(input) {
  input.analysis.baselineReview = {
    confirmedAt: '2026-10-03T09:05:00+08:00', periodLabel: input.context.periodLabel,
    fields: MODEL_CATALOG.find(model => model.id === input.analysis.model).required.map(field => ({
      companyId: input.companies[0].id, field, value: input.companies[0][field],
      ...(input.companies[0].baselineSources?.[field] || { kind: 'user' }),
    })),
  };
  return input;
}
test('approved materials and online routes compute unchanged formulas; legacy sources remain compatible', () => {
  const expected = computeQuant(base('volume_price')).companies[0].delta.grossProfit;
  for (const route of ['materials', 'online']) {
    const input = confirmBaseline(routedInput(route));
    assert.equal(validateQuant(input).valid, true);
    near(computeQuant(input).companies[0].delta.grossProfit, expected);
  }
  const legacy = base('volume_price');
  legacy.companies[0].baselineSources = { baselineRevenue: { kind: 'user' } };
  assert.equal(validateQuant(legacy).valid, true);
  legacy.companies[0].baselineSources.baselineRevenue = { kind: 'reference', evidenceId: 'demo-baseline' };
  assert.equal(validateQuant(legacy).valid, true);
});
test('route categories, bound evidence and approval must all be valid before a routed value can be confirmed', () => {
  const cases = [
    source => { source.route = 'unsupported'; },
    source => { source.kind = 'user'; },
    source => { source.evidenceId = 'missing'; },
    source => { delete source.review; },
    source => { source.review.status = 'pending'; },
    source => { source.review.period = '不一致期间'; },
  ];
  for (const mutate of cases) {
    const input = routedInput(); mutate(input.companies[0].baselineSources.baselineRevenue);
    assert.equal(validateQuant(input).valid, false);
    assert.throws(() => computeQuant(input));
  }
  for (const badEvidence of [{ kind: 'assumption' }, { source: '' }]) {
    const input = routedInput(); Object.assign(input.evidence.at(-1), badEvidence);
    assert.equal(validateQuant(input).valid, false);
  }
  const assumption = base('volume_price');
  assumption.companies[0].baselineSources = { baselineRevenue: { kind: 'assumption', route: 'assumption' } };
  assert.equal(validateQuant(assumption).valid, true);
  assumption.companies[0].baselineSources.baselineRevenue.kind = 'reference';
  assert.equal(validateQuant(assumption).valid, false);
});
test('approval timestamps require a real ISO instant; final confirmation cannot predate approval', () => {
  for (const timestamp of ['2026-10-03', '2026-02-30T09:00:00Z', '2026-10-03T09:99:00Z', '2026-10-03T09:00:00']) {
    const input = routedInput(); input.companies[0].baselineSources.baselineRevenue.review.reviewedAt = timestamp;
    assert.equal(validateQuant(input).valid, false, timestamp);
  }
  const input = confirmBaseline(routedInput());
  input.analysis.baselineReview.confirmedAt = '2026-10-03T08:59:00+08:00';
  assert.equal(validateQuant(input).valid, false);
  input.analysis.baselineReview.confirmedAt = '2026-02-30T09:05:00Z';
  assert.equal(validateQuant(input).valid, false);
});
test('routed snapshots detect changed sources, missing review metadata and changed periods', () => {
  const input = confirmBaseline(routedInput());
  input.analysis.baselineReview.fields[0].route = 'online';
  assert.equal(validateQuant(input).valid, false);
  input.analysis.baselineReview.fields[0].route = 'materials';
  delete input.analysis.baselineReview.fields[0].review;
  assert.equal(validateQuant(input).valid, false);
  const current = confirmBaseline(routedInput()); current.context.periodLabel = '新期间';
  assert.equal(validateQuant(current).valid, false);
  const malformed = confirmBaseline(routedInput()); malformed.analysis.baselineReview.fields = [null];
  assert.equal(validateQuant(malformed).valid, false);
});
test('missing draft values stay unknown even with a source and cannot become confirmed zero values', () => {
  const input = routedInput(); input.companies[0].baselineRevenue = null;
  assert.equal(validateQuant(input).valid, true);
  assert.ok(validateQuant(input).missing[0].fields.includes('baselineRevenue'));
  assert.equal(computeQuant(input).companies[0].status, 'missing');
  confirmBaseline(input);
  assert.equal(validateQuant(input).valid, false);
});
test('market-only input needs no operating parameters or financial period, and ignores old financial reviews', () => {
  const input = base('event_study');
  delete input.parameters;
  delete input.context.periodLabel;
  input.companies[0].baselineRevenue = null;
  input.companies[0].baselineSources = {
    baselineRevenue: { kind: 'reference', route: 'materials', evidenceId: 'old-unbound-financial-source',
      review: { status: 'pending', reviewedAt: 'invalid', period: '旧财务期间' } },
  };
  input.analysis.baselineReview = { confirmedAt: '2026-10-03T09:05:00+08:00', periodLabel: '旧财务期间',
    fields: [{ companyId: 'old-company', field: 'baselineRevenue', value: null, kind: 'reference', route: 'materials' }] };
  const snapshot = structuredClone(input), validation = validateQuant(input);
  assert.equal(validation.valid, true);
  assert.equal(validation.missing.length, 0);
  const result = computeQuant(input, { marketData: DEMO_MARKET_DATA });
  assert.equal(result.marketStudy.status, 'available');
  assert.equal(result.companies.length, 0);
  assert.deepEqual(result.parameters, {});
  assert.deepEqual(result.context, input.context);
  assert.deepEqual(result.scenarios, []);
  assert.deepEqual(result.baselineReview.fields, []);
  assert.deepEqual(input, snapshot, '内部兼容默认值不能写回用户输入');
});
test('volume-price ignores unused raw-material source metadata but still checks current fields', () => {
  const input = confirmBaseline(base('volume_price'));
  input.companies[0].rawMaterialCostSharePct = null;
  input.companies[0].baselineSources = { rawMaterialCostSharePct: { kind: 'reference', route: 'online',
    evidenceId: 'old-unbound-source', review: { status: 'pending', reviewedAt: 'invalid', period: '旧原料期间' } } };
  input.analysis.baselineReview.fields.push({ companyId: 'old-company', field: 'rawMaterialCostSharePct', value: null, kind: 'reference', route: 'online' });
  assert.equal(validateQuant(input).valid, true);
  near(computeQuant(input).companies[0].delta.grossProfit, 200);
  input.companies[0].baselineSources.baselineRevenue = { kind: 'reference', route: 'online', evidenceId: 'missing' };
  assert.equal(validateQuant(input).valid, false);
  delete input.companies[0].baselineSources.baselineRevenue;
  input.companies[0].baselineSources.unknownField = { kind: 'user' };
  assert.equal(validateQuant(input).valid, false);
});
