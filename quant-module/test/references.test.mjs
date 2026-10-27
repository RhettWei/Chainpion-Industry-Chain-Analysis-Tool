import test from 'node:test';
import assert from 'node:assert/strict';
import { findBaselineReferences } from '../src/references.mjs';
import { createAppServer } from '../server.mjs';
const body = { companyName: '测试制造企业', industry: '制造业', field: 'baselineRevenue', code: '300750.SZ', periodEnd: '2025-12-31', asOf: '2026-06-01' };
const financial = rows => Response.json({ code: 0, data: { fields: ['ts_code', 'ann_date', 'f_ann_date', 'end_date', 'report_type', 'comp_type', 'revenue', 'oper_cost'], items: rows } });
const row = ['300750.SZ', '20260301', '20260302', '20251231', '1', '1', 10000000, 8000000];
test('financial references convert amounts and derive margins with explicit period, disclosure date and locator', async () => {
  const result = await findBaselineReferences(body, { token: 'private-test-token', fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body); assert.equal(request.api_name, 'income'); assert.equal(request.params.period, '20251231'); return financial([row]);
  } });
  assert.equal(result.candidates[0].value, 1000); assert.equal(result.candidates[0].unit, '万元');
  assert.equal(result.candidates[0].publishedAt, '2026-03-02'); assert.equal(result.candidates[0].status, 'reference');
  assert.match(result.candidates[0].locator, /10000/); assert.ok(!JSON.stringify(result).includes('private-test-token'));
  const margin = await findBaselineReferences({ ...body, field: 'baselineGrossMarginPct' }, { token: 'test-token', fetchImpl: async () => financial([row]) });
  assert.equal(margin.candidates[0].value, 20);
});
test('post-cutoff disclosure, wrong period, unconsolidated and financial-company rows never fill references', async () => {
  for (const bad of [row.map((value, index) => index === 2 ? '20260701' : value), row.map((value, index) => index === 3 ? '20250930' : value), row.map((value, index) => index === 4 ? '6' : value), row.map((value, index) => index === 5 ? '2' : value)]) {
    const result = await findBaselineReferences(body, { token: 'test-token', fetchImpl: async () => financial([bad]) });
    assert.equal(result.candidates.length, 0); assert.match(result.warnings.join(' '), /合并财报/);
  }
});
test('null revenue or cost is not converted into a zero or a fabricated margin', async () => {
  const revenue = await findBaselineReferences(body, { token: 'test-token', fetchImpl: async () => financial([row.map((value, index) => index === 6 ? null : value)]) });
  assert.equal(revenue.candidates.length, 0);
  const margin = await findBaselineReferences({ ...body, field: 'baselineGrossMarginPct' }, { token: 'test-token', fetchImpl: async () => financial([row.map((value, index) => index === 7 ? null : value)]) });
  assert.equal(margin.candidates.length, 0);
});
test('official web adapter returns escaped text and source links, never guesses numeric values from snippets', async () => {
  const result = await findBaselineReferences({ ...body, field: 'rawMaterialCostSharePct' }, { searchKey: 'secret-search-key', fetchImpl: async (url, options) => {
    assert.match(url, /^https:\/\/api.search.brave.com\/res\/v1\/web\/search/); assert.equal(options.headers['X-Subscription-Token'], 'secret-search-key');
    return Response.json({ web: { results: [{ title: '<b>公告</b>', url: 'https://www.cninfo.com.cn/report.pdf', description: '<script>fake</script>成本结构 65%' }, { title: '非官方', url: 'https://example.org/research' }, { title: '恶意', url: 'javascript:alert(1)' }] } });
  } });
  assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].title, '公告');
  assert.equal(Object.hasOwn(result.candidates[0], 'value'), false); assert.ok(!JSON.stringify(result).includes('secret-search-key'));
});
test('no credential makes zero external requests and labels manual links as uns searched fallbacks', async () => {
  let calls = 0;
  const result = await findBaselineReferences(body, { fetchImpl: async () => { calls++; throw new Error(); } });
  assert.equal(calls, 0); assert.equal(result.candidates.length, 0); assert.match(result.warnings.join(' '), /不是已搜索/); assert.ok(result.manualLinks.length > 0);
});
test('upstream errors do not leak keys; unsupported fields and invalid dates fail before network calls', async () => {
  const result = await findBaselineReferences(body, { token: 'secret-private', searchKey: 'secret-search', fetchImpl: async () => { throw new Error('secret-private secret-search'); } });
  assert.ok(!JSON.stringify(result).includes('secret-private')); assert.ok(!JSON.stringify(result).includes('secret-search'));
  await assert.rejects(findBaselineReferences({ ...body, field: 'net_profit' }), /有效/);
  await assert.rejects(findBaselineReferences({ ...body, asOf: '2026-02-30' }), /截止日/);
  await assert.rejects(findBaselineReferences({ ...body, periodEnd: '2025-12-30' }), /季末/);
});
test('reference server route retains same-origin checks and cannot expose search credential configuration', async () => {
  const server = createAppServer({ searchKey: 'configured-secret', fetchImpl: async () => Response.json({ web: { results: [] } }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const health = await (await fetch(`${origin}/api/health`)).json(); assert.equal(health.searchConfigured, true); assert.ok(!JSON.stringify(health).includes('configured-secret'));
    const response = await fetch(`${origin}/api/baseline-references`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, code: '', field: 'variableCostSharePct' }) });
    assert.equal(response.status, 200); assert.equal((await response.json()).usage.requests, 1);
    const blocked = await fetch(`${origin}/api/baseline-references`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.org' }, body: JSON.stringify(body) });
    assert.equal(blocked.status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
