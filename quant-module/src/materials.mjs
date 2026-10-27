import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { extname, join } from 'node:path';
import { homedir } from 'node:os';
import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const MAX_FILE = 3 * 1024 * 1024;
const MAX_TEXT = 100000;
const DEFINITIONS = {
  baselineRevenue: { title: '基线营业收入', type: 'money', words: ['营业收入', '营业总收入', '主营业务收入', '销售收入', 'baselineRevenue'] },
  baselineGrossMarginPct: { title: '基线毛利率', type: 'ratio', words: ['销售毛利率', '毛利率', 'baselineGrossMarginPct', 'grossMarginPct'] },
  rawMaterialCostSharePct: { title: '原料占营业成本比例', type: 'ratio', words: ['原材料成本占比', '原料成本占比', '原材料占营业成本', '原料占营业成本', '原材料费用占成本', 'rawMaterialCostSharePct'] },
  variableCostSharePct: { title: '变动成本占营业成本比例', type: 'ratio', words: ['变动成本占比', '变动成本占营业成本', 'variableCostSharePct'] },
  fixedOperatingCost: { title: '固定经营费用', type: 'money', words: ['固定经营费用', '固定营业费用', '固定经营成本', 'fixedOperatingCost'] },
};
const crcTable = new Uint32Array(256).map((_, number) => { let crc = number; for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; return crc >>> 0; });
function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
class MaterialError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
function fail(message, status = 400) { throw new MaterialError(message, status); }
function validDate(value) { const parsed = new Date(`${value}T00:00:00Z`); return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }
function normalize(text) { return String(text).replace(/[\s\u3000,，.。:：;；()（）\[\]【】"']/g, '').toLowerCase(); }
function decodeXml(text) {
  return text.replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi, (_, number, named) => {
    if (number) { const value = number[0].toLowerCase() === 'x' ? Number.parseInt(number.slice(1), 16) : Number(number); return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : ''; }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[named.toLowerCase()];
  });
}
function decodeText(bytes, maxBytes = MAX_FILE) {
  if (bytes.length > maxBytes) fail('资料内容超过解析体积限制，请拆分相关章节。', 413);
  if (bytes.length > 2 && bytes[0] === 255 && bytes[1] === 254) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2));
  if (bytes.length > 2 && bytes[0] === 254 && bytes[1] === 255) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('文字文件不是有效的 UTF-8 / UTF-16，请另存为 UTF-8 或直接粘贴相关段落。'); }
}
function docxText(bytes) {
  if (bytes.length < 22) fail('DOCX 文件结构损坏，请重新保存或粘贴相关段落。');
  const minimum = Math.max(0, bytes.length - 65557);
  let end = bytes.length - 22;
  for (; end >= minimum; end--) if (bytes.readUInt32LE(end) === 0x06054b50) break;
  if (end < minimum || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length) fail('DOCX 文件结构损坏，请重新保存或粘贴相关段落。');
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12), centralStart = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count || count === 0xffff || centralStart === 0xffffffff) fail('暂不支持分卷或 ZIP64 DOCX，请另存为普通 DOCX。');
  if (count > 500 || centralStart + centralSize > end) fail('DOCX 条目过多或结构异常，请只上传相关章节。', 413);
  let cursor = centralStart, expanded = 0;
  const names = new Set();
  let document;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) fail('DOCX 目录损坏，请重新保存。');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), crc = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24), nameLength = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32), offset = bytes.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extra + comment;
    if (next > centralStart + centralSize) fail('DOCX 目录长度无效。');
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (flags & 1) fail('资料受密码保护，请解密后上传或粘贴相关文字。');
    if (![0, 8].includes(method) || size === 0xffffffff || compressed === 0xffffffff) fail('DOCX 使用了暂不支持的压缩格式。');
    if (names.has(name) || /(^|[\\/])\.\.([\\/]|$)|^[\\/]/.test(name)) fail('DOCX 目录存在重复或异常文件路径。');
    names.add(name);
    expanded += size;
    if (size > 8 * 1024 * 1024 || expanded > 16 * 1024 * 1024 || (compressed === 0 ? size > 0 : size / compressed > 200)) fail('DOCX 解压体积或压缩比超过限制，请拆分相关章节。', 413);
    if (name === 'word/document.xml') {
      if (offset + 30 > centralStart || bytes.readUInt32LE(offset) !== 0x04034b50) fail('DOCX 正文位置无效。');
      if (bytes.readUInt16LE(offset + 6) & 1) fail('资料受密码保护，请解密后上传。');
      const nameSize = bytes.readUInt16LE(offset + 26), extraSize = bytes.readUInt16LE(offset + 28), start = offset + 30 + nameSize + extraSize;
      if (start + compressed > centralStart) fail('DOCX 正文超出文件范围。');
      if (bytes.subarray(offset + 30, offset + 30 + nameSize).toString('utf8') !== name) fail('DOCX 正文名称与目录不一致。');
      try { document = method === 0 ? bytes.subarray(start, start + compressed) : inflateRawSync(bytes.subarray(start, start + compressed), { maxOutputLength: 8 * 1024 * 1024 }); }
      catch { fail('DOCX 正文无法安全解压，请重新保存。'); }
      if (document.length !== size || crc32(document) !== crc) fail('DOCX 正文校验失败，请重新保存。');
    }
    cursor = next;
  }
  if (!document) fail('未找到 DOCX 正文。旧版 DOC 文件请转为 DOCX，或直接粘贴文字。');
  const xml = decodeText(document, 8 * 1024 * 1024);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('DOCX 含不支持的 XML 声明，请重新保存。');
  const tables = xml.replace(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g, row => row.replace(/<\/w:p>/g, ' ').replace(/<\/w:tc>/g, '\t').replace(/<\/w:tr>/g, '\n'));
  return decodeXml(tables.replace(/<w:(?:tab|br|cr)\b[^>]*\/?\s*>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, ''));
}

async function pdfModule() {
  if (process.env.PDFJS_MODULE) {
    const url = process.env.PDFJS_MODULE.startsWith('file:') ? process.env.PDFJS_MODULE : pathToFileURL(process.env.PDFJS_MODULE).href;
    if (!url.startsWith('file:')) return null;
    try { await access(new URL(url)); return url; } catch { return null; }
  }
  try { return import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs'); } catch {}
  const bundled = join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs');
  try { await access(bundled); return pathToFileURL(bundled).href; } catch { return null; }
}
async function pdfText(bytes, warnings) {
  const moduleUrl = await pdfModule();
  if (!moduleUrl) { warnings.push('此机器未配置本地 PDF 文字解析器。请粘贴 PDF 中相关文字，或上传 TXT / DOCX；资料未发送到外部服务。'); return ''; }
  const script = `
    console.log = console.warn = () => {};
    const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk);
    let pdf;
    try {
      const {getDocument}=await import(process.argv[1]);
      pdf=await getDocument({data:new Uint8Array(Buffer.concat(chunks)),isEvalSupported:false,disableFontFace:true,useSystemFonts:false,useWorkerFetch:false}).promise;
      const pages=[]; let characters=0;
      for(let number=1;number<=Math.min(pdf.numPages,200);number++) {
        const page=await pdf.getPage(number),content=await page.getTextContent();
        const text=content.items.map(item=>item.str+(item.hasEOL?'\\n':' ')).join('');
        characters+=text.length;
        if(characters>100000) {process.stdout.write(JSON.stringify({error:'text_limit'})); process.exit(0);}
        pages.push('【PDF第'+number+'页】\\n'+text); page.cleanup();
      }
      process.stdout.write(JSON.stringify({text:pages.join('\\n'),truncated:pdf.numPages>200}));
      await pdf.destroy();
    } catch(error) {process.stdout.write(JSON.stringify({error:error.name==='PasswordException'?'password':'parse'}));}
  `;
  const parsed = await new Promise(resolve => {
    const child = spawn(process.execPath, ['--max-old-space-size=256', '--input-type=module', '-e', script, moduleUrl], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '', length = 0, finished = false;
    const finish = result => { if (finished) return; finished = true; clearTimeout(timer); resolve(result); };
    const timer = setTimeout(() => { child.kill(); finish({ error: 'timeout' }); }, 15000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { length += Buffer.byteLength(chunk); if (length > 600000) { child.kill(); finish({ error: 'text_limit' }); } else output += chunk; });
    child.stderr.resume();
    child.on('error', () => finish({ error: 'unavailable' }));
    child.on('close', () => { if (finished) return; try { finish(JSON.parse(output)); } catch { finish({ error: 'parse' }); } });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
  if (parsed.error === 'password') fail('PDF 受密码保护，请解密后上传或粘贴文字。');
  if (parsed.error === 'text_limit') fail('PDF 可检索文字超过 100,000 字符，请只上传相关章节。', 413);
  if (parsed.error) { warnings.push(parsed.error === 'timeout' ? '本地 PDF 解析达到 15 秒限制，请拆分文件或粘贴相关段落。' : 'PDF 文字无法解析，可能是扫描件或结构异常。请补充可检索文字或粘贴相关段落。'); return ''; }
  if (parsed.truncated) warnings.push('PDF 超过 200 页，本次只解析前 200 页；其他章节请单独上传。');
  return parsed.text ?? '';
}
function csvParagraphs(text) {
  const delimiter = text.split(/\r?\n/)[0].includes('\t') ? '\t' : ',';
  const rows = [], cells = [];
  let cell = '', quoted = false;
  for (let index = 0; index <= text.length; index++) {
    const char = text[index];
    if (char === '"') { if (quoted && text[index + 1] === '"') { cell += '"'; index++; } else quoted = !quoted; }
    else if ((char === delimiter || char === '\n' || char === undefined) && !quoted) {
      cells.push(cell.replace(/\r$/, '').trim()); cell = '';
      if (char !== delimiter) { if (cells.some(Boolean)) rows.push(cells.splice(0)); else cells.length = 0; }
    } else cell += char;
  }
  if (quoted) fail('CSV 引号未闭合，请检查文件或粘贴相关行。');
  if (rows.length < 2) return rows.map((row, index) => ({ text: row.join('；'), locator: `CSV 第 ${index + 1} 行` }));
  const headers = rows[0];
  return rows.slice(1).map((row, index) => ({ text: row.map((value, column) => `${headers[column] || `列 ${column + 1}`}：${value}`).join('；'), locator: `CSV 数据第 ${index + 1} 行（含表头）` }));
}
function textParagraphs(text) {
  let page = null;
  return text.split(/\r?\n|\f/).flatMap((line, index) => {
    const pageMarker = /^【PDF第(\d+)页】$/.exec(line.trim());
    if (pageMarker) { page = pageMarker[1]; return []; }
    if (!line.trim()) return [];
    // ponytail: long lines are bounded excerpts; a document semantic parser can replace this when needed.
    return line.trim().match(/[\s\S]{1,3000}/g).map((part, chunk) => ({ text: part, locator: `${page ? `PDF 第 ${page} 页，` : ''}段落 ${index + 1}${chunk ? ` · 分段 ${chunk + 1}` : ''}` }));
  });
}
function units(text) { return [...text.matchAll(/(?:人民币\s*)?(亿元|百万元|千万元|万元|千元|元|%|％|百分比|百分点)/g)].map(match => ({ unit: match[1] === '％' || match[1] === '百分比' ? '%' : match[1], index: match.index })); }
function numberCandidates(text, definition, globalUnit) {
  const found = [];
  const dates = [...text.matchAll(/(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}/g)].map(match => [match.index, match.index + match[0].length]);
  for (const match of text.matchAll(/[-−]?\(?\d[\d,，]*(?:\.\d+)?\)?/g)) {
    const number = match[0];
    const after = text.slice(match.index + number.length);
    if (dates.some(([start, end]) => match.index >= start && match.index < end) || /^\s*(年|年度|月|日|期)/.test(after) || (/^(19|20)\d{2}$/.test(number) && /^\s*[-/]/.test(after))) continue;
    const previous = text.slice(0, match.index);
    const nearestAfter = units(after.slice(0, 14))[0];
    const beforeUnit = units(previous.slice(-35)).at(-1);
    const unit = nearestAfter?.index < 4 ? nearestAfter.unit : beforeUnit?.unit ?? globalUnit;
    if (definition.type === 'money' && ['%', '百分点'].includes(unit)) continue;
    if (definition.type === 'ratio' && unit && !['%', '百分点'].includes(unit)) continue;
    const negative = number.startsWith('(') && number.endsWith(')');
    const value = Number(number.replace(/[(),，]/g, '').replace('−', '-')) * (negative ? -1 : 1);
    if (Number.isFinite(value)) found.push({ value, ...(unit ? { unit } : {}) });
  }
  return found.slice(0, 3);
}

export async function extractMaterial(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('资料请求必须为对象。');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 200 || /[\u0000-\u001F]/.test(name)) fail('请提供有效的资料名称（不超过 200 字符）。');
  if (typeof body.companyName !== 'string' || !body.companyName.trim() || body.companyName.length > 120) fail('请先选择需要核验的企业。');
  if (!Array.isArray(body.fields) || !body.fields.length || body.fields.length > 5 || body.fields.some(field => !Object.hasOwn(DEFINITIONS, field))) fail('请指定有效的基线字段。');
  if (!validDate(body.asOf)) fail('研究截止日应为有效 YYYY-MM-DD。');
  if (typeof body.periodLabel !== 'string' || !body.periodLabel.trim() || body.periodLabel.length > 150) fail('请明确基线期间。');
  if (body.publishedAt !== undefined && body.publishedAt !== '' && !validDate(body.publishedAt)) fail('资料发布日期应为有效 YYYY-MM-DD。');
  if ((typeof body.text === 'string') === (typeof body.base64 === 'string')) fail('请提供粘贴文字或一个文件，不能同时提交两种内容。');
  const warnings = [];
  const extension = extname(name).toLowerCase();
  let text;
  if (typeof body.text === 'string') text = body.text;
  else {
    if (body.base64.length > Math.ceil(MAX_FILE / 3) * 4) fail('单份资料最多 3 MB，请拆分相关章节后上传。', 413);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64) || body.base64.length % 4 !== 0) fail('文件编码无效，请重新选择文件。');
    const bytes = Buffer.from(body.base64, 'base64');
    if (bytes.length > MAX_FILE) fail('单份资料最多 3 MB，请拆分相关章节后上传。', 413);
    if (extension === '.docx') text = docxText(bytes);
    else if (extension === '.pdf') {
      if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) fail('文件不是可识别的 PDF。');
      text = await pdfText(bytes, warnings);
    } else if (['.txt', '.csv', '.json', '.md', '.text'].includes(extension)) text = decodeText(bytes);
    else fail('支持 TXT、CSV、JSON、DOCX 和可检索 PDF。旧 DOC / 图片请转为文字或粘贴相关段落。');
  }
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (text.length > MAX_TEXT) fail('资料文字超过 100,000 字符，请拆分相关章节。', 413);
  if (/[\u0000]/.test(text)) fail('文字资料含无法识别的二进制内容，请重新保存为 UTF-8。');
  const materialId = `material-${createHash('sha256').update(name).update(text).digest('hex').slice(0, 16)}`;
  const material = { id: materialId, name, excerpt: text.slice(0, 2000), characters: text.length };
  if (!text.replace(/【PDF第\d+页】/g, '').trim()) { warnings.push('没有提取到可检索文字；扫描件需先提供文字或人工粘贴相关段落。'); return { material, candidates: [], warnings: [...new Set(warnings)], usage: { requests: 0 } }; }
  let paragraphs;
  if (extension === '.csv') paragraphs = csvParagraphs(text);
  else if (extension === '.json') {
    let value; try { value = JSON.parse(text); } catch { fail('JSON 资料格式无效，请检查后上传。'); }
    const entries = Array.isArray(value) ? value : [value];
    paragraphs = entries.slice(0, 2000).map((item, index) => ({ text: JSON.stringify(item).slice(0, 3000), locator: `JSON 条目 ${index + 1}` }));
    if (entries.length > 2000) warnings.push('JSON 条目超过 2,000，本次仅检查前 2,000 条。');
  } else paragraphs = textParagraphs(text);
  const companyName = normalize(body.companyName);
  if (!normalize(text).includes(companyName)) warnings.push(`资料中未匹配到企业“${body.companyName}”；候选仅为字段线索，需确认所属企业。`);
  const declaredUnits = [...text.matchAll(/(?:金额单位|单位)\s*[:：]\s*(?:人民币\s*)?(亿元|百万元|千万元|万元|千元|元)/g)].map(match => match[1]);
  const globalUnit = new Set(declaredUnits).size === 1 ? declaredUnits[0] : undefined;
  const candidates = [];
  const fields = [...new Set(body.fields)];
  for (const paragraph of paragraphs) {
    for (const field of fields) {
      const definition = DEFINITIONS[field];
      const lower = paragraph.text.toLowerCase();
      const matches = definition.words.map(word => ({ word, index: lower.indexOf(word.toLowerCase()) })).filter(match => match.index >= 0).sort((a, b) => a.index - b.index);
      if (!matches.length) continue;
      const first = matches[0];
      const after = paragraph.text.slice(first.index + first.word.length, first.index + first.word.length + 160);
      // Stop at the next known financial field so one cell's number cannot leak to another.
      const nextIndices = Object.values(DEFINITIONS).flatMap(item => item.words).map(word => after.toLowerCase().indexOf(word.toLowerCase())).filter(index => index > 0);
      const segment = after.slice(0, nextIndices.length ? Math.min(...nextIndices) : after.length);
      const fieldUnit = segment.match(/["']?(?:unit|单位)["']?\s*[:：]\s*["']?(亿元|百万元|千万元|万元|千元|元|%|％|百分点)/i)?.[1];
      const found = numberCandidates(segment, definition, fieldUnit ?? (definition.type === 'money' ? globalUnit : undefined));
      const companyMatched = normalize(paragraph.text).includes(companyName);
      const periods = [...new Set([...paragraph.text.matchAll(/(?:19|20)\d{2}\s*年(?:度|第[一二三四1234]季度|上半年|下半年)?/g)].map(match => match[0]))];
      const period = periods.length === 1 ? periods[0] : undefined;
      for (const value of found.length ? found : [{}]) {
        if (candidates.length >= 30) break;
        const start = paragraph.text.length > 3000 ? Math.max(0, first.index - 250) : 0;
        candidates.push({ id: `${materialId}-${field}-${candidates.length + 1}`, field, ...value, title: definition.title, source: `用户资料：${name}`, description: paragraph.text.slice(start, start + 3000), locator: `${paragraph.locator}${start ? ` · 原段落字符 ${start + 1} 起` : ''}`, ...(period ? { period } : {}), ...(body.publishedAt ? { publishedAt: body.publishedAt } : {}), companyMatched });
      }
    }
    if (candidates.length >= 30) { warnings.push('候选超过 30 条，仅返回前 30 条；可拆分更具体的章节继续核验。'); break; }
  }
  if (!candidates.length) warnings.push('没有找到指定字段的可定位候选，请补充包含企业名称、字段、数值、单位和期间的原文。');
  if (candidates.some(item => !item.companyMatched)) warnings.push('部分候选所在段落未匹配企业名称，请核验其企业归属。');
  if (candidates.some(item => item.value !== undefined && !item.unit)) warnings.push('部分数值未明确单位；金额不做换算，比例也不自动视为百分数。');
  if (candidates.some(item => !item.period)) warnings.push(`部分候选未识别来源期间，不能自动认定属于“${body.periodLabel}”。`);
  if (body.publishedAt && body.publishedAt > body.asOf) warnings.push('资料发布日期晚于研究截止日，不能用于当时可知信息的回测。');
  warnings.push('候选仅用于核验，不会自动写入基线；请确认企业、原始单位、期间与字段口径后应用。');
  return { material, candidates, warnings: [...new Set(warnings)], usage: { requests: 0 } };
}
