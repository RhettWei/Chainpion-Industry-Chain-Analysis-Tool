import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateQuant, computeQuant } from '../src/models.mjs';
import { DEMO_MARKET_DATA } from '../src/demo.mjs';

test('资料表单字段与企业角色可以交给严格输入协议', async () => {
  const [schemaText, html, app] = await Promise.all([
    readFile(new URL('../contracts/input.schema.json', import.meta.url), 'utf8'),
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.mjs', import.meta.url), 'utf8'),
  ]);
  const schema = JSON.parse(schemaText);
  const evidenceSchema = schema.properties.evidence.items;
  const evidenceForm = html.match(/<form\b[^>]*id="evidence-form"[^>]*>([\s\S]*?)<\/form>/)?.[1];
  assert.ok(evidenceForm, '页面应保留资料来源表单');
  const names = [...evidenceForm.matchAll(/\bname="([^"]+)"/g)].map(match => match[1]);
  assert.ok(names.length >= 4, '应有资料的实际输入字段');
  for (const name of names) assert.ok(Object.hasOwn(evidenceSchema.properties, name), `表单字段 ${name} 未在严格协议中声明`);

  const roleDefinition = app.match(/const roles\s*=\s*\{([^}]+)\}/)?.[1];
  assert.ok(roleDefinition, '应能定位页面角色选项');
  const roleNames = [...roleDefinition.matchAll(/\b([a-z_]+)\s*:/g)].map(match => match[1]);
  for (const role of roleNames) assert.ok(schema.properties.companies.items.properties.role.enum.includes(role), `角色 ${role} 不在协议中`);

  // Optional fields must be absent when blank: the strict contract rejects "".
  const datePattern = new RegExp(schema.$defs.date.pattern);
  const urlPattern = new RegExp(evidenceSchema.properties.url.pattern);
  assert.equal(datePattern.test(''), false);
  assert.equal(urlPattern.test(''), false);
  assert.ok(!evidenceSchema.required.includes('publishedAt'));
  assert.ok(!evidenceSchema.required.includes('url'));
});

test('字段来源与基准确认快照使用同一获取路线和审核协议', async () => {
  const schema = JSON.parse(await readFile(new URL('../contracts/input.schema.json', import.meta.url), 'utf8'));
  const source = schema.$defs.fieldSource;
  const snapshot = schema.properties.analysis.properties.baselineReview.properties.fields.items;
  for (const shape of [source, snapshot]) {
    assert.equal(shape.properties.route.$ref, '#/$defs/sourceRoute');
    assert.equal(shape.properties.review.$ref, '#/$defs/sourceReview');
    assert.ok(shape.allOf.some(rule => rule.$ref === '#/$defs/sourceRouteRules'));
    assert.ok(!shape.required.includes('route'), '旧协议来源不强制增加route');
  }
  assert.deepEqual(schema.$defs.sourceRoute.enum, ['assumption', 'materials', 'online']);
  assert.equal(schema.$defs.sourceReview.properties.status.const, 'approved');
  assert.deepEqual(schema.$defs.sourceReview.required, ['status', 'reviewedAt', 'period']);
});

test('独立行情输入和经营输入的条件必填协议与实际模型入口一致', async () => {
  const schema = JSON.parse(await readFile(new URL('../contracts/input.schema.json', import.meta.url), 'utf8'));
  const condition = schema.allOf.find(rule => rule.if?.properties?.analysis?.properties?.model?.const === 'event_study');
  assert.ok(condition, '必须按显式event_study选择行情输入分支');
  assert.deepEqual(condition.if.required, ['analysis']);
  assert.deepEqual(condition.if.properties.analysis.required, ['model']);
  const marketInput = { schemaVersion: '1.0', analysis: { model: 'event_study' },
    context: { industry: '测试行业', eventDescription: '测试事件', eventDate: '2026-09-01', asOf: '2026-10-02' } };
  const eventRequired = [...schema.required, ...(condition.then.required || [])];
  for (const key of eventRequired) assert.ok(Object.hasOwn(marketInput, key), `行情输入不应缺少协议必填 ${key}`);
  for (const key of schema.properties.context.required) assert.ok(Object.hasOwn(marketInput.context, key));
  assert.ok(!eventRequired.includes('parameters') && !eventRequired.includes('companies'));
  assert.ok(!schema.properties.context.required.includes('periodLabel'));
  assert.ok(!schema.properties.parameters.required, '行情输入即使提供空parameters也不应被经营字段拦截');
  assert.equal(validateQuant(marketInput).valid, true);
  assert.equal(computeQuant(marketInput, { marketData: DEMO_MARKET_DATA }).marketStudy.status, 'available');
  assert.equal(validateQuant({ ...marketInput, companies: [], evidence: [], parameters: {} }).valid, true);

  assert.deepEqual(condition.else.required, ['parameters', 'companies']);
  assert.ok(condition.else.properties.context.required.includes('periodLabel'));
  assert.equal(condition.else.properties.parameters.required.length, 6);
  assert.ok(condition.else.properties.analysis.properties.baselineReview.required.includes('periodLabel'));
  assert.equal(validateQuant({ ...marketInput, analysis: { model: 'volume_price' } }).valid, false);
});
