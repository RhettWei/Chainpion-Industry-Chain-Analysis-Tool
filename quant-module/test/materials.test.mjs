import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { extractMaterial } from '../src/materials.mjs';
import { createAppServer } from '../server.mjs';

const request = { name: '摘录.txt', companyName: '甲公司', fields: ['baselineRevenue', 'baselineGrossMarginPct'], asOf: '2026-10-02', periodLabel: '2025年度', publishedAt: '2026-03-01' };

test('plain material preserves raw value, unit, company, period, paragraph and does not infer missing units', async () => {
  const input = { ...request, text: '甲公司 2025年度 营业收入2亿元，毛利率20%。\n甲公司营业收入5000。' };
  const before = JSON.stringify(input);
  const result = await extractMaterial(input);
  assert.equal(result.candidates.find(item => item.field === 'baselineRevenue').value, 2);
  assert.equal(result.candidates.find(item => item.field === 'baselineRevenue').unit, '亿元');
  assert.equal(result.candidates.find(item => item.field === 'baselineGrossMarginPct').value, 20);
  assert.equal(result.candidates.find(item => item.field === 'baselineGrossMarginPct').unit, '%');
  assert.equal(result.candidates[0].companyMatched, true);
  assert.equal(result.candidates[0].period, '2025年度');
  assert.match(result.candidates[0].locator, /段落 1/);
  assert.match(result.candidates[0].description, /营业收入2亿元/);
  assert.equal(result.candidates.at(-1).unit, undefined);
  assert.match(result.warnings.join(' '), /未明确单位/);
  assert.equal(result.usage.requests, 0);
  assert.equal(JSON.stringify(input), before);
});

test('company mismatch, missing figures and dates after the cutoff stay explicit', async () => {
  const result = await extractMaterial({ ...request, publishedAt: '2027-01-01', text: '乙公司营业收入尚未披露；毛利率待核实。' });
  assert.equal(result.candidates[0].companyMatched, false);
  assert.equal(result.candidates[0].value, undefined);
  assert.match(result.warnings.join(' '), /未匹配到企业/);
  assert.match(result.warnings.join(' '), /晚于研究截止日/);
});

test('CSV uses column headers with original units; JSON accepts field names and declared unit metadata', async () => {
  const csv = await extractMaterial({ ...request, name: '财务.csv', text: '公司,营业收入(万元),毛利率(%)\n甲公司,"1,234.5",20\n乙公司,900,25' });
  assert.equal(csv.candidates[0].value, 1234.5);
  assert.equal(csv.candidates[0].unit, '万元');
  assert.equal(csv.candidates[1].value, 20);
  assert.equal(csv.candidates[1].unit, '%');
  assert.equal(csv.candidates[2].companyMatched, false);
  assert.match(csv.candidates[0].locator, /CSV 数据第 1 行/);
  const json = await extractMaterial({ ...request, name: '财务.json', fields: ['baselineRevenue'], text: JSON.stringify({ companyName: '甲公司', baselineRevenue: { value: 2, unit: '亿元' }, publishedAt: '2026-03-01' }) });
  assert.equal(json.candidates[0].value, 2);
  assert.equal(json.candidates[0].unit, '亿元');
  assert.equal(json.candidates.length, 1, 'JSON dates must not become additional financial values');
});

test('amount extraction skips a percentage growth figure and retains an explicit header unit', async () => {
  const growth = await extractMaterial({ ...request, fields: ['baselineRevenue'], text: '甲公司营业收入同比增长10%，达到2亿元。' });
  assert.equal(growth.candidates.length, 1);
  assert.equal(growth.candidates[0].value, 2);
  assert.equal(growth.candidates[0].unit, '亿元');
  const header = await extractMaterial({ ...request, fields: ['baselineRevenue'], text: '金额单位：万元\n甲公司2025年度营业收入1,000。' });
  assert.equal(header.candidates[0].value, 1000);
  assert.equal(header.candidates[0].unit, '万元');
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; }
  return (value ^ 0xffffffff) >>> 0;
}
function docxBytes(xml, { encrypted = false, declaredSize, count = 1, filename = 'word/document.xml' } = {}) {
  const name = Buffer.from(filename), data = Buffer.from(xml), packed = deflateRawSync(data), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(encrypted ? 1 : 0, 6); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(encrypted ? 1 : 0, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(declaredSize ?? data.length, 24); central.writeUInt16LE(name.length, 28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + packed.length, 16);
  return Buffer.concat([local, name, packed, central, name, end]);
}
const xml = '<w:document><w:body><w:p><w:r><w:t>甲公司2025年度营业收入2,000万元，毛利率20%</w:t></w:r></w:p></w:body></w:document>';
test('bounded DOCX parser retains text and rejects password, expansion, too many entries and path traversal', async () => {
  const result = await extractMaterial({ ...request, name: '财报.docx', base64: docxBytes(xml).toString('base64') });
  assert.equal(result.candidates[0].value, 2000);
  assert.equal(result.candidates[0].unit, '万元');
  assert.equal(result.candidates[1].value, 20);
  await assert.rejects(extractMaterial({ ...request, name: '财报.docx', base64: docxBytes(xml, { encrypted: true }).toString('base64') }), /密码保护/);
  await assert.rejects(extractMaterial({ ...request, name: '财报.docx', base64: docxBytes(xml, { declaredSize: 20 * 1024 * 1024 }).toString('base64') }), /解压体积/);
  await assert.rejects(extractMaterial({ ...request, name: '财报.docx', base64: docxBytes(xml, { count: 501 }).toString('base64') }), /条目过多/);
  await assert.rejects(extractMaterial({ ...request, name: '财报.docx', base64: docxBytes(xml, { filename: '../document.xml' }).toString('base64') }), /异常文件路径/);
});

test('material size, invalid formats and ambiguous request boundaries are rejected', async () => {
  await assert.rejects(extractMaterial({ ...request, text: 'a'.repeat(100001) }), /100,000/);
  await assert.rejects(extractMaterial({ ...request, name: '旧版.doc', base64: Buffer.from('example').toString('base64') }), /旧 DOC/);
  await assert.rejects(extractMaterial({ ...request, text: 'x', base64: 'eA==' }), /不能同时/);
  await assert.rejects(extractMaterial({ ...request, fields: ['unknown'], text: 'x' }), /有效的基线字段/);
  await assert.rejects(extractMaterial({ ...request, name: 'x.json', text: '{bad' }), /JSON 资料格式/);
  await assert.rejects(extractMaterial({ ...request, base64: 'not base64' }), /编码无效/);
});

function smallPdf(text) {
  const stream = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(content)); content += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(content);
  content += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}
test('optional PDF parser extracts local text or clearly reports missing parser; blank pages require searchable text', async () => {
  const result = await extractMaterial({ ...request, name: 'report.pdf', companyName: 'SampleCo', fields: ['baselineRevenue'], base64: smallPdf('SampleCo baselineRevenue: 1000').toString('base64') });
  if (result.warnings.some(warning => warning.includes('未配置本地 PDF 文字解析器'))) assert.equal(result.candidates.length, 0);
  else { assert.equal(result.candidates[0]?.value, 1000); assert.match(result.candidates[0].locator, /PDF 第 1 页/); }
  const blank = await extractMaterial({ ...request, name: 'blank.pdf', base64: smallPdf('').toString('base64') });
  assert.equal(blank.candidates.length, 0);
  assert.match(blank.warnings.join(' '), /可检索文字|本地 PDF 文字解析器/);
});

test('material API stays same-origin, makes no network requests and never auto-applies candidates', async () => {
  let requests = 0;
  const server = createAppServer({ fetchImpl: async () => { requests++; throw new Error('unexpected network'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (body, extra = {}) => fetch(`${origin}/api/material-extract`, { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
  try {
    const response = await post({ ...request, text: '甲公司2025年度营业收入2000万元。' });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.usage.requests, 0);
    assert.equal(result.candidates[0].value, 2000);
    assert.equal(Object.hasOwn(result, 'companies'), false);
    assert.equal(requests, 0);
    assert.equal((await post({ ...request, text: '资料' }, { origin: 'https://other.example' })).status, 403);
    assert.equal((await post({ ...request, text: 'x'.repeat(100001) })).status, 413);
    assert.equal((await fetch(`${origin}/src/materials.mjs`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
