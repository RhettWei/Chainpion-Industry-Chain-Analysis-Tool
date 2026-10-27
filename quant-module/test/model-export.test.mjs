import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { DEMO_INPUT, DEMO_MARKET_DATA } from '../src/demo.mjs';
import { computeQuant } from '../src/models.mjs';
import { buildReport } from '../src/reports.mjs';
import { createAppServer } from '../server.mjs';

function reviewed(model) {
  const input = structuredClone(DEMO_INPUT); input.analysis = { model };
  const fields = model === 'event_study' ? [] : input.companies.flatMap(company => ['baselineRevenue', 'baselineGrossMarginPct', 'variableCostSharePct', 'fixedOperatingCost'].map(field => ({ companyId: company.id, field, value: company[field], kind: 'assumption', evidenceId: company.evidenceIds[0] })));
  input.analysis.baselineReview = { confirmedAt: new Date().toISOString(), periodLabel: input.context.periodLabel, fields };
  return input;
}
function documentXml(buffer) {
  let cursor = 0;
  while (buffer.readUInt32LE(cursor) === 0x04034b50) {
    const length = buffer.readUInt32LE(cursor + 18), size = buffer.readUInt16LE(cursor + 26), extra = buffer.readUInt16LE(cursor + 28);
    const name = buffer.subarray(cursor + 30, cursor + 30 + size).toString(), start = cursor + 30 + size + extra;
    if (name === 'word/document.xml') return inflateRawSync(buffer.subarray(start, start + length)).toString();
    cursor = start + length;
  }
  throw new Error('Missing Word document');
}
test('CVP Word/HTML/Markdown keep selected formulas, confirmed baselines and honest data labels', () => {
  const input = reviewed('break_even'), result = computeQuant(input);
  for (const format of ['docx', 'html', 'markdown']) {
    const report = buildReport({ input, result, format, detail: 'full' });
    const text = format === 'docx' ? documentXml(report.buffer) : report.buffer.toString();
    assert.match(text, /本量利／盈亏平衡/); assert.match(text, /用户已确认/); assert.match(text, /情景假设/);
    assert.match(text, /贡献毛益率/); assert.match(text, /用户确认时间/); assert.match(text, /基准营业收入|基线收入/);
  }
});
test('market API and report recalculate window values from submitted prices and ignore forged market conclusions', async () => {
  const server = createAppServer({}); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const input = reviewed('event_study'), origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const options = { input, marketData: DEMO_MARKET_DATA, before: 3, after: 3 };
    const result = await (await post('/api/compute', options)).json();
    assert.equal(result.modelId, 'event_study'); assert.equal(result.marketStudy.series.length, 7);
    const response = await post('/api/export', { ...options, result: { summary: { headline: '伪造市场结论' } }, marketResult: { series: [{ car: 999999 }] }, format: 'markdown', detail: 'full' });
    assert.equal(response.status, 200); const report = await response.text();
    assert.match(report, /行情窗口 T−3 至 T\+3/); assert.match(report, /演示/);
    assert.ok(!report.includes('伪造市场结论')); assert.ok(!report.includes('999999'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
