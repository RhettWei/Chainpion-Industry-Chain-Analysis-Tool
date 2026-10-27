import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { createAppServer } from '../server.mjs';
import { buildReport } from '../src/reports.mjs';
import { runEventStudy } from '../src/core.mjs';

async function usingServer(options, run) {
  const server = createAppServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const marketBody = { eventDate: '2020-01-20', asOf: '2020-02-20', codes: ['000001.SZ'] };

test('server exposes only explicit files; request boundaries and token remain private', async () => {
  const secret = 'test-secret-token-do-not-return';
  await usingServer({ token: secret }, async origin => {
    const health = await (await fetch(`${origin}/api/health`)).json();
    assert.equal(health.tokenConfigured, true);
    assert.ok(!JSON.stringify(health).includes(secret));
    assert.equal((await fetch(`${origin}/server.mjs`)).status, 404);
    assert.equal((await fetch(`${origin}/src/reports.mjs`)).status, 404);
    const schema = await fetch(`${origin}/contracts/input.schema.json`);
    assert.equal(schema.status, 200);
    assert.match(schema.headers.get('content-type'), /application\/json/);
    assert.equal((await post(`${origin}/api/compute`, {})).status, 400);
    assert.equal((await post(`${origin}/api/market-data`, { ...marketBody, codes: ['bad'] })).status, 400);
    assert.equal((await post(`${origin}/api/market-data`, marketBody, { origin: 'https://unrelated.example' })).status, 403);
  });
});

test('missing adjustment permission preserves raw-price event data with an explicit warning', async () => {
  const dates = ['20200116', '20200117', '20200120', '20200121', '20200122', '20200123'];
  const mock = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.api_name === 'adj_factor') return Response.json({ code: -1, msg: '无接口权限' });
    const data = request.api_name === 'daily'
      ? { fields: ['trade_date', 'close', 'vol'], items: dates.map((date, index) => [date, 10 + index * .1, 100]) }
      : { fields: ['trade_date', 'close'], items: dates.map((date, index) => [date, 100 + index]) };
    return Response.json({ code: 0, data });
  };
  await usingServer({ fetchImpl: mock, token: 'private-token-test' }, async origin => {
    const response = await post(`${origin}/api/market-data`, marketBody);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.companies[0].prices.length, dates.length);
    assert.equal(Object.hasOwn(data.companies[0].prices[0], 'adjFactor'), false);
    assert.match(data.warnings.join(' '), /复权/);
    const study = runEventStudy({ ...data, eventDate: marketBody.eventDate, asOf: marketBody.asOf, before: 1, after: 2 });
    assert.ok(study.series.length >= 3);
    assert.match(study.warnings.join(' '), /复权/);
  });
});

test('market adapter normalizes dates, caps cutoff, caches by credentials without returning credentials', async () => {
  const calls = [];
  const mock = async (_url, options) => {
    const request = JSON.parse(options.body);
    calls.push(request);
    const datasets = {
      daily: { fields: ['trade_date', 'close', 'vol'], items: [['20200121', 12.5, 100], ['20200120', 12, 90]] },
      adj_factor: { fields: ['trade_date', 'adj_factor'], items: [['20200121', 1.2], ['20200120', 1.2]] },
      index_daily: { fields: ['trade_date', 'close'], items: [['20200120', 4000], ['20200121', 4010]] },
    };
    return Response.json({ code: 0, data: datasets[request.api_name] });
  };
  await usingServer({ fetchImpl: mock, token: 'private-token-alpha' }, async origin => {
    const first = await (await post(`${origin}/api/market-data`, marketBody)).json();
    assert.equal(first.companies[0].prices[0].date, '2020-01-20');
    assert.equal(first.companies[0].prices[0].adjFactor, 1.2);
    assert.equal(first.usage.requests, 3);
    assert.equal(first.provenance.params.endDate, '2020-02-20');
    assert.ok(!JSON.stringify(first).includes('private-token'));
    const cached = await (await post(`${origin}/api/market-data`, marketBody)).json();
    assert.equal(cached.usage.requests, 0);
    assert.equal(cached.usage.cacheHits, 3);
    await post(`${origin}/api/market-data`, { ...marketBody, token: 'private-token-beta' });
    assert.equal(calls.length, 6);
    assert.equal(calls[0].params.end_date, '20200220');
  });
});

test('upstream permission errors and timeouts are actionable without leaking token or upstream messages', async () => {
  await usingServer({ token: 'secret-token-value', fetchImpl: async () => Response.json({ code: -1, msg: '权限 secret-token-value' }) }, async origin => {
    const response = await post(`${origin}/api/market-data`, marketBody);
    assert.equal(response.status, 502);
    const error = await response.json();
    assert.match(error.error, /权限/);
    assert.ok(!error.error.includes('secret-token-value'));
  });
  await usingServer({ token: 'secret-token-value', upstreamTimeoutMs: 10, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) }, async origin => {
    const response = await post(`${origin}/api/market-data`, marketBody);
    assert.equal(response.status, 504);
    assert.match((await response.json()).error, /超时/);
  });
  let fetchCount = 0;
  await usingServer({ token: 'secret-token-value', overallTimeoutMs: 0, fetchImpl: async () => { fetchCount++; return Response.json({ code: 0, data: {} }); } }, async origin => {
    const response = await post(`${origin}/api/market-data`, marketBody);
    assert.equal(response.status, 504);
    assert.match((await response.json()).error, /总等待时间/);
    assert.equal(fetchCount, 0);
  });
});

test('export recalculates operating values from the input rather than trusting a submitted result', async () => {
  const input = {
    schemaVersion: '1.0', context: { industry: '制造', eventDescription: '原料涨价', eventDate: '2020-01-20', asOf: '2020-02-20', periodLabel: '年度基线' },
    parameters: { shockPct: 10, volumePct: 0, passThroughPct: 0, exposurePct: 100, lagMonths: 0, horizonMonths: 12 },
    companies: [{ id: 'c1', name: '测试制造企业', role: '中游', shockChannel: 'cost', baselineRevenue: 1000, baselineGrossMarginPct: 20, rawMaterialCostSharePct: 50, variableCostSharePct: 70 }], evidence: [],
  };
  await usingServer({}, async origin => {
    const response = await post(`${origin}/api/export`, { input, result: { summary: { headline: '伪造的报告结论' }, companies: [{ name: '测试制造企业', baseline: { grossProfit: 99999999 } }] }, format: 'markdown', detail: 'brief' });
    assert.equal(response.status, 200);
    const report = await response.text();
    assert.ok(!report.includes('伪造的报告结论'));
    assert.ok(!report.includes('99999999'));
    assert.ok(report.includes('毛利 | 200 万元 | 160 万元 | -40 万元'));
    assert.match(response.headers.get('content-disposition'), /attachment/);
  });
});

test('report delivery link serves a real attachment; expired and missing links return 404', async () => {
  const payload = {
    input: {
      schemaVersion: '1.0', context: { industry: '制造', eventDescription: '原料涨价', eventDate: '2020-01-20', asOf: '2020-02-20', periodLabel: '年度基线' },
      parameters: { shockPct: 10, volumePct: 0, passThroughPct: 0, exposurePct: 100, lagMonths: 0, horizonMonths: 12 },
      companies: [{ id: 'c1', name: '测试制造企业', role: '中游', shockChannel: 'cost', baselineRevenue: 1000, baselineGrossMarginPct: 20, rawMaterialCostSharePct: 50, variableCostSharePct: 70 }], evidence: [],
    }, result: {}, format: 'docx', detail: 'brief', delivery: 'link',
  };
  await usingServer({}, async origin => {
    const response = await post(`${origin}/api/export`, payload);
    assert.equal(response.status, 200);
    const link = await response.json();
    assert.match(link.url, /^\/api\/download\/[0-9a-f-]{36}$/);
    assert.match(link.filename, /\.docx$/);
    const download = await fetch(`${origin}${link.url}`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition'), /attachment/);
    assert.match(download.headers.get('content-type'), /wordprocessingml/);
    assert.ok(unzipLocal(Buffer.from(await download.arrayBuffer())).has('word/document.xml'));
    assert.equal((await fetch(`${origin}/api/download/00000000-0000-4000-8000-000000000000`)).status, 404);
  });
  await usingServer({ downloadTtlMs: 0 }, async origin => {
    const link = await (await post(`${origin}/api/export`, payload)).json();
    const expired = await fetch(`${origin}${link.url}`);
    assert.equal(expired.status, 404);
    assert.match((await expired.json()).error, /过期/);
  });
});

function unzipLocal(buffer) {
  const entries = new Map();
  let cursor = 0;
  while (buffer.readUInt32LE(cursor) === 0x04034b50) {
    const length = buffer.readUInt32LE(cursor + 18), size = buffer.readUInt16LE(cursor + 26), extra = buffer.readUInt16LE(cursor + 28);
    const name = buffer.subarray(cursor + 30, cursor + 30 + size).toString();
    const start = cursor + 30 + size + extra;
    entries.set(name, inflateRawSync(buffer.subarray(start, start + length)));
    cursor = start + length;
  }
  return entries;
}
const reportInput = {
  context: { industry: '金属 & 制造', eventDescription: '<冲击>', eventDate: '2020-01-20', asOf: '2020-02-20' },
  parameters: { shockPct: 10 },
  evidence: [{ id: 'e1', title: '原文', kind: 'observed', source: '官方数据源', description: '成本口径说明', url: 'https://example.org/report?a=1&b=2', locator: '第 12 页', publishedAt: '2020-01-10' }, { id: 'e2', title: '恶意链接', kind: 'user', url: 'javascript:alert(1)' }],
};
test('exports genuine OOXML docx with evidence hyperlinks, escaped content and optional image; HTML is safe', () => {
  const payload = { input: reportInput, result: { modelId: 'cost_transmission', summary: { headline: '结果 <示例>' }, companies: [], warnings: ['仅演示'] }, marketResult: { series: [], dataProvenance: { provider: '演示合成行情', kind: 'assumption', description: '确定性合成序列，不是真实股价' } }, detail: 'full', format: 'docx',
    charts: [{ title: '影响图', png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=' }] };
  const report = buildReport(payload);
  assert.equal(report.extension, 'docx');
  const entries = unzipLocal(report.buffer);
  assert.ok(entries.has('[Content_Types].xml'));
  assert.ok(entries.has('word/document.xml'));
  assert.ok(entries.has('word/media/image1.png'));
  const xml = entries.get('word/document.xml').toString();
  assert.ok(xml.includes('金属 &amp; 制造'));
  assert.ok(xml.includes('结果 &lt;示例&gt;'));
  assert.ok(xml.includes('第 12 页'));
  // An operating report must not incorporate an unrelated market snapshot.
  assert.ok(!xml.includes('演示合成行情'));
  assert.ok(xml.includes('官方数据源'));
  assert.ok(xml.includes('成本口径说明'));
  assert.ok(!xml.includes('行情提供方'));
  const rels = entries.get('word/_rels/document.xml.rels').toString();
  assert.ok(rels.includes('https://example.org/report?a=1&amp;b=2'));
  assert.ok(!rels.includes('javascript:'));
  const html = buildReport({ ...payload, format: 'html' }).buffer.toString();
  assert.ok(html.includes('&lt;冲击&gt;'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('data:image/png;base64,'));
  const brief = buildReport({ ...payload, detail: 'brief', format: 'markdown', marketResult: { dataProvenance: { provider: '用户导入：行情.csv' } } }).buffer.toString();
  assert.ok(!brief.includes('用户导入：行情.csv'));
  assert.ok(brief.includes('<冲击>'));
  assert.ok(brief.includes('官方数据源'));
  assert.ok(brief.includes('成本口径说明'));
});
