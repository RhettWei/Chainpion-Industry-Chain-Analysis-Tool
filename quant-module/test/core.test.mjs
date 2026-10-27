import test from 'node:test';
import assert from 'node:assert/strict';
import { computeOperating, runEventStudy, validateInput } from '../src/core.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);
function input() {
  return { schemaVersion: '1.0', context: { industry: '测试产业链', eventDescription: '原料涨价', eventDate: '2026-09-01', asOf: '2026-09-30', periodLabel: '年度基线' },
    parameters: { shockPct: 10, volumePct: 0, passThroughPct: 40, exposurePct: 100, lagMonths: 0, horizonMonths: 12 },
    companies: [{ id: 'mid', name: '测试制造企业', role: '中游', shockChannel: 'cost', baselineRevenue: 1000, baselineGrossMarginPct: 20,
      rawMaterialCostSharePct: 50, variableCostSharePct: 80, fixedOperatingCost: 100, evidenceIds: ['assumption'] }],
    evidence: [{ id: 'assumption', title: '测试样例', kind: 'assumption', source: '手工复算' }] };
}

test('hand calculated operating bridge and optional operating profit', () => {
  const result = computeOperating(input()), company = result.companies[0];
  near(company.baseline.cogs, 800);
  near(company.scenario.revenue, 1016);
  near(company.scenario.cogs, 840);
  near(company.scenario.grossProfit, 176);
  near(company.delta.grossProfit, -24);
  near(company.delta.operatingProfitPct, -24);
  near(company.bridge.reduce((sum, item) => sum + item.value, 0), company.delta.grossProfit);
  assert.equal(result.scenarios.length, 3);
  assert.ok(result.scenarios[0].companies[0].delta.grossProfit < result.scenarios[2].companies[0].delta.grossProfit);
});

test('zero shock and volume exactly preserve baseline; no invented operating profit', () => {
  const data = input(); data.parameters.shockPct = 0; delete data.companies[0].fixedOperatingCost;
  const result = computeOperating(data).companies[0];
  near(result.delta.grossProfit, 0); near(result.delta.grossMarginPp, 0);
  assert.equal(result.scenario.operatingProfit, undefined);
});

test('volume cost and price shock coexist without double counting', () => {
  const data = input(); data.parameters.volumePct = 10; data.parameters.lagMonths = 6;
  const result = computeOperating(data).companies[0];
  // R=1100 × 1.008; COGS=800+64+22; GP delta=1108.8-886-200.
  near(result.scenario.revenue, 1108.8); near(result.scenario.cogs, 886); near(result.delta.grossProfit, 22.8);
  near(result.bridge.reduce((sum, item) => sum + item.value, 0), 22.8);
});

test('selling-price channel responds to price with no duplicate raw-price charge', () => {
  const data = input(); data.companies[0].shockChannel = 'selling_price';
  const result = computeOperating(data);
  near(result.companies[0].scenario.revenue, 1100); near(result.companies[0].scenario.cogs, 800);
  near(result.companies[0].delta.grossProfit, 100);
  assert.ok(result.scenarios[2].companies[0].parameters.shockPct > result.scenarios[0].companies[0].parameters.shockPct);
});

test('missing fields degrade without precise profit and ranges reject invalid input', () => {
  const data = input(); data.companies[0].rawMaterialCostSharePct = null;
  assert.equal(validateInput(data).valid, true);
  const company = computeOperating(data).companies[0];
  assert.equal(company.status, 'missing'); assert.equal(company.scenario, undefined);
  data.parameters.exposurePct = 101;
  assert.equal(validateInput(data).valid, false); assert.throws(() => computeOperating(data), /exposurePct/);
  data.parameters.exposurePct = 100; data.companies[0].rawMaterialCostSharePct = 90;
  assert.throws(() => computeOperating(data), /变动成本/);
});

test('a loss-making baseline avoids deceptive percentage growth', () => {
  const data = input(); data.companies[0].fixedOperatingCost = 300;
  assert.equal(computeOperating(data).companies[0].delta.operatingProfitPct, null);
});

function prices() {
  return ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07', '2026-09-08', '2026-09-09'].map((date, index) => ({ date, close: 100 * (1.02 ** index), volume: 100 + index, adjFactor: 1 }));
}
function marketData() {
  return { eventDate: '2026-09-07', asOf: '2026-09-09', before: 1, after: 1,
    companies: [{ id: 'stock', name: '示例证券', prices: prices() }], benchmark: prices().map((row, index) => ({ date: row.date, close: 100 * 1.01 ** index })) };
}

test('CAR uses only selected window AR; cumulative price returns compound', () => {
  const result = runEventStudy(marketData());
  assert.equal(result.status, 'available'); assert.equal(result.series.length, 3);
  near(result.companies[0].car, 3); near(result.series.at(-1).car, 3);
  near(result.series.at(-1).portfolioCumulative, (1.02 ** 3 - 1) * 100);
  assert.equal(result.series[0].date, '2026-09-04');
});

test('cutoff prevents lookahead and does not revert future event to last row', () => {
  const data = marketData(); data.asOf = '2026-09-07';
  const result = runEventStudy(data);
  assert.ok(result.series.every(row => row.date <= data.asOf));
  assert.equal(result.status, 'insufficient');
  data.eventDate = '2026-09-10';
  assert.equal(runEventStudy(data).status, 'unavailable');
  data.asOf = '2026-09-30';
  assert.equal(runEventStudy(data).status, 'unavailable');
});

test('non-trading event maps forward to first real benchmark date', () => {
  const data = marketData(); data.eventDate = '2026-09-05';
  assert.equal(runEventStudy(data).tradingEventDate, '2026-09-07');
});

test('missing prices are not zero filled or treated as one-session resumed returns', () => {
  const data = marketData(); data.companies[0].prices = data.companies[0].prices.filter(row => row.date !== '2026-09-07');
  const result = runEventStudy(data);
  assert.equal(result.companies[0].sampleDays, 1);
  assert.equal(result.series.length, 1);
  near(result.companies[0].car, 1);
  assert.equal(result.status, 'insufficient');
});

test('missing stock stays visible while an existing security produces a real portfolio', () => {
  const data = marketData(); data.companies.push({ id: 'missing', name: '无行情企业', prices: [] });
  const result = runEventStudy(data);
  assert.equal(result.companies[1].car, null); assert.equal(result.companies[1].sampleDays, 0);
  assert.ok(result.series.every(row => row.n === 1)); near(result.series.at(-1).car, 3);
});

test('bad date and nonfinite values do not slip past validation', () => {
  const data = input(); data.context.eventDate = '2026-02-30';
  assert.equal(validateInput(data).valid, false);
  data.context.eventDate = '2026-09-01'; data.parameters.shockPct = NaN;
  assert.equal(validateInput(data).valid, false);
});

test('sparse selection returns explicit no-estimate result instead of a fatal error', () => {
  const data = input(); data.companies = [];
  const result = computeOperating(data);
  assert.equal(result.companies.length, 0); assert.equal(result.summary.best, null);
  assert.match(result.warnings.join(' '), /尚未选定企业/);
});

test('only pre-event stock returns cannot be called an available event reaction', () => {
  const data = marketData(); data.before = 3;
  data.companies[0].prices = data.companies[0].prices.filter(row => row.date < data.eventDate);
  const result = runEventStudy(data);
  assert.equal(result.status, 'insufficient');
  assert.equal(result.companies[0].status, 'insufficient');
  assert.match(result.warnings.join(' '), /不能判断事件后/);
});
