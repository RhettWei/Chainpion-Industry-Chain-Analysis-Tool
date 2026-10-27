import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { buildReport } from './src/reports.mjs';
import { computeQuant } from './src/models.mjs';
import { findBaselineReferences } from './src/references.mjs';
import { extractMaterial } from './src/materials.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
class RequestError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function json(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(data));
}
async function readJson(request, maxBytes) {
  if (!String(request.headers['content-type'] ?? '').includes('application/json')) throw new RequestError('请使用 JSON 格式提交请求。');
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBytes) throw new RequestError('提交内容过大，请减少图表或资料内容。', 413);
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RequestError('提交内容不是有效的 JSON。'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestError('请求必须是一个对象。');
  return body;
}
function dateValue(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RequestError(`${field}应为 YYYY-MM-DD。`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new RequestError(`${field}不是有效日期。`);
  return value;
}
function offsetDate(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
function chinaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function securityCode(value, field = '证券代码') {
  if (typeof value !== 'string' || !/^\d{6}\.(SH|SZ|BJ)$/.test(value)) throw new RequestError(`${field}应为 000001.SZ 一类证券代码。`);
  return value;
}
function normalizeTradeDate(date) { return /^\d{8}$/.test(String(date)) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : null; }
function rowsOf(data) {
  if (!data || !Array.isArray(data.fields) || !Array.isArray(data.items)) throw new RequestError('数据服务返回了无法识别的内容，请稍后重试。', 502);
  return data.items.map(row => Object.fromEntries(data.fields.map((field, index) => [field, row[index]])));
}
function validatedCalculation(input, options) {
  try { return computeQuant(input, options); }
  catch (error) { throw new RequestError(typeof error.message === 'string' ? error.message.slice(0, 500) : '参数不合法，请检查输入。'); }
}

export function createAppServer({ fetchImpl = globalThis.fetch, token = process.env.TUSHARE_TOKEN ?? '', searchKey = process.env.BRAVE_SEARCH_API_KEY ?? '', port = Number(process.env.PORT) || 4318, upstreamTimeoutMs = 25000, overallTimeoutMs = 120000, downloadTtlMs = 5 * 60 * 1000 } = {}) {
  // ponytail: process-local cache, replace only if independent users require persistent quotas.
  const cache = new Map();
  const downloads = new Map();
  function downloadHeaders(output, filename) {
    return { 'content-type': output.mime, 'content-disposition': `attachment; filename="futurechain-quant.${output.extension}"; filename*=UTF-8''${encodeURIComponent(filename)}`, 'cache-control': 'no-store' };
  }
  async function fetchMarket(body) {
    const eventDate = dateValue(body.eventDate, '事件日期');
    const asOf = dateValue(body.asOf, '研究截止日');
    if (!Array.isArray(body.codes) || body.codes.length < 1 || body.codes.length > 5) throw new RequestError('请提供 1—5 个证券代码。');
    const codes = [...new Set(body.codes.map(code => securityCode(code)))];
    const benchmarkCode = securityCode(body.benchmarkCode ?? '000300.SH', '基准代码');
    const requestToken = typeof body.token === 'string' && body.token.trim() ? body.token.trim() : token;
    if (typeof requestToken !== 'string' || requestToken.length < 8 || requestToken.length > 512 || /[\r\n]/.test(requestToken)) throw new RequestError('请在数据设置中填写 Tushare Token，或在服务端配置 TUSHARE_TOKEN。');
    const today = chinaToday();
    if (eventDate > today || eventDate > asOf) throw new RequestError('事件尚未发生或晚于研究截止日，可先使用经营情景分析；不能获取已实现的事件后反应。');
    const startDate = offsetDate(eventDate, -240);
    const endDate = [offsetDate(eventDate, 70), asOf, today].sort()[0];
    const params = { start_date: startDate.replaceAll('-', ''), end_date: endDate.replaceAll('-', '') };
    const usage = { requests: 0, cacheHits: 0, elapsedMs: 0 };
    const started = Date.now();
    const tokenHash = createHash('sha256').update(requestToken).digest('hex');
    async function query(api_name, apiParams, fields) {
      const remainingMs = overallTimeoutMs - (Date.now() - started);
      if (remainingMs <= 0) throw new RequestError('本次行情取数已达到总等待时间，请减少样本或稍后重试。', 504);
      const key = `${tokenHash}:${api_name}:${JSON.stringify(apiParams)}:${fields}`;
      const saved = cache.get(key);
      if (saved && saved.expires > Date.now()) { usage.cacheHits++; return saved.rows; }
      usage.requests++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(upstreamTimeoutMs, remainingMs));
      try {
        const upstream = await fetchImpl('https://api.tushare.pro', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ api_name, token: requestToken, params: apiParams, fields }), signal: controller.signal });
        if (!upstream.ok) throw new RequestError(`Tushare ${api_name} 请求暂未成功，请稍后重试。`, 502);
        let payload;
        try { payload = await upstream.json(); } catch { throw new RequestError(`Tushare ${api_name} 返回内容无法读取。`, 502); }
        if (payload.code !== 0) {
          const permission = /权限|积分|permission/i.test(String(payload.msg));
          throw new RequestError(permission ? `账号暂未开通 Tushare ${api_name} 接口，请核对权限；已输入的经营情景仍可计算。` : `Tushare ${api_name} 查询失败，请检查账号状态与调用频率。`, 502);
        }
        const rows = rowsOf(payload.data);
        cache.set(key, { rows, expires: Date.now() + 10 * 60 * 1000 });
        while (cache.size > 80) cache.delete(cache.keys().next().value);
        return rows;
      } catch (error) {
        if (controller.signal.aborted) throw new RequestError(`Tushare ${api_name} 查询超时，请稍后重试。`, 504);
        if (error instanceof RequestError) throw error;
        throw new RequestError(`无法连接 Tushare ${api_name} 数据服务，请检查网络后重试。`, 502);
      } finally { clearTimeout(timer); }
    }
    const warnings = [];
    const companies = [];
    for (const code of codes) {
      const daily = await query('daily', { ...params, ts_code: code }, 'ts_code,trade_date,close,vol');
      let factors = [];
      try { factors = await query('adj_factor', { ...params, ts_code: code }, 'ts_code,trade_date,adj_factor'); }
      catch (error) { warnings.push(`${code} 复权因子未取得，市场分析需降级为原始价格描述。${error.message}`); }
      const factorMap = new Map(factors.filter(row => Number.isFinite(Number(row.adj_factor)) && Number(row.adj_factor) > 0).map(row => [row.trade_date, Number(row.adj_factor)]));
      const prices = daily.map(row => ({ date: normalizeTradeDate(String(row.trade_date)), close: Number(row.close), volume: row.vol != null && Number.isFinite(Number(row.vol)) ? Number(row.vol) : null, ...(factorMap.has(row.trade_date) ? { adjFactor: factorMap.get(row.trade_date) } : {}) })).filter(row => row.date && row.close > 0 && Number.isFinite(row.close)).sort((a, b) => a.date.localeCompare(b.date));
      if (!prices.length) warnings.push(`${code} 在查询窗口内没有有效行情，可能未上市、停牌或代码不匹配。`);
      if (prices.some(row => row.adjFactor === undefined)) warnings.push(`${code} 部分交易日缺少复权因子，不能把原始收盘价跳变解释为事件反应。`);
      companies.push({ id: code, name: code, role: '样本', prices });
    }
    const benchmarkRows = await query('index_daily', { ...params, ts_code: benchmarkCode }, 'ts_code,trade_date,close');
    const benchmark = benchmarkRows.map(row => ({ date: normalizeTradeDate(String(row.trade_date)), close: Number(row.close) })).filter(row => row.date && row.close > 0 && Number.isFinite(row.close)).sort((a, b) => a.date.localeCompare(b.date));
    if (!benchmark.length) warnings.push('基准在查询窗口内没有有效行情；请更换基准或补充数据。');
    usage.elapsedMs = Date.now() - started;
    return { companies, benchmark, provenance: { provider: 'Tushare Pro', kind: 'observed', description: 'Tushare API 返回的个股日行情、复权因子与指数行情；复权缺失和空数据另列警告。', interfaces: ['daily', 'adj_factor', 'index_daily'], fetchedAt: new Date().toISOString(), params: { eventDate, asOf, effectiveAsOf: endDate, startDate, endDate, codes, benchmarkCode }, volumeUnit: '手' }, usage, warnings };
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    try {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      if (request.method === 'GET' && pathname === '/api/health') return json(response, 200, { status: 'ok', tokenConfigured: Boolean(token), searchConfigured: Boolean(searchKey), port: server.address()?.port ?? port });
      const downloadId = /^\/api\/download\/([0-9a-f-]{36})$/.exec(pathname)?.[1];
      if ((request.method === 'GET' || request.method === 'HEAD') && downloadId) {
        const saved = downloads.get(downloadId);
        if (!saved || saved.expires <= Date.now()) {
          downloads.delete(downloadId);
          throw new RequestError('下载链接已过期或不存在，请重新导出报告。', 404);
        }
        response.writeHead(200, downloadHeaders(saved.output, saved.filename));
        return response.end(request.method === 'HEAD' ? undefined : saved.output.buffer);
      }
      if (request.method === 'POST' && pathname.startsWith('/api/')) {
        const origin = request.headers.origin;
        if (origin && origin !== `http://${request.headers.host}`) throw new RequestError('请求来源不匹配，请从本模块页面操作。', 403);
        const bodyLimit = pathname === '/api/material-extract' ? 8 * 1024 * 1024 : pathname === '/api/export' ? 3 * 1024 * 1024 : 1024 * 1024;
        const body = await readJson(request, bodyLimit);
        if (pathname === '/api/compute') {
          return json(response, 200, validatedCalculation(body.input || body, { marketData: body.marketData, before: body.before, after: body.after }));
        }
        if (pathname === '/api/market-data') return json(response, 200, await fetchMarket(body));
        if (pathname === '/api/baseline-references') {
          try { return json(response, 200, await findBaselineReferences(body, { fetchImpl, token, searchKey, timeoutMs: upstreamTimeoutMs })); }
          catch (error) { throw new RequestError(error.status ? error.message : '参考数据查询未完成，请检查输入。', error.status || 502); }
        }
        if (pathname === '/api/material-extract') {
          try { return json(response, 200, await extractMaterial(body)); }
          catch (error) { throw new RequestError(error.status ? error.message : '资料解析未完成，请提供可检索文字或相关段落。', error.status || 400); }
        }
        if (pathname === '/api/export') {
          if (!body.input || typeof body.input !== 'object' || !body.result || typeof body.result !== 'object') throw new RequestError('导出需要研究输入与计算结果。');
          if (!['docx', 'html', 'markdown'].includes(body.format)) throw new RequestError('导出格式应为 docx、html 或 markdown。');
          if (!['brief', 'full'].includes(body.detail)) throw new RequestError('请选择简版或详版报告。');
          if (body.delivery !== undefined && body.delivery !== 'link') throw new RequestError('下载方式无效，请重新导出。');
          const calculated = validatedCalculation(body.input, { marketData: body.marketData, before: body.before, after: body.after });
          const output = buildReport({ ...body, result: calculated, ...(calculated.modelId === 'event_study' ? { marketResult: { ...calculated.marketStudy, dataProvenance: body.marketData?.provenance } } : {}) });
          const filename = `FutureChain量化报告-${body.detail === 'brief' ? '简版' : '详版'}.${output.extension}`;
          if (body.delivery === 'link') {
            for (const [id, saved] of downloads) if (saved.expires <= Date.now()) downloads.delete(id);
            const id = randomUUID();
            downloads.set(id, { output, filename, expires: Date.now() + downloadTtlMs });
            while (downloads.size > 6) downloads.delete(downloads.keys().next().value);
            return json(response, 200, { url: `/api/download/${id}`, filename });
          }
          response.writeHead(200, downloadHeaders(output, filename));
          return response.end(output.buffer);
        }
        throw new RequestError('接口不存在。', 404);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') throw new RequestError('此地址不支持该请求方式。', 405);
      if (pathname.startsWith('/api/')) throw new RequestError('接口不存在。', 404);
      const explicitFiles = { '/src/core.mjs': 'src/core.mjs', '/src/models.mjs': 'src/models.mjs', '/src/scenarios.mjs': 'src/scenarios.mjs', '/src/demo.mjs': 'src/demo.mjs', '/src/display.mjs': 'src/display.mjs', '/src/visual-data.mjs': 'src/visual-data.mjs', '/contracts/input.schema.json': 'contracts/input.schema.json' };
      const explicitPath = explicitFiles[pathname];
      const publicRoot = resolve(ROOT, 'public');
      const path = explicitPath ? join(ROOT, explicitPath) : resolve(publicRoot, `.${decodeURIComponent(pathname === '/' ? '/index.html' : pathname)}`);
      if (!explicitPath && !path.startsWith(`${publicRoot}\\`) && !path.startsWith(`${publicRoot}/`)) throw new RequestError('文件不存在。', 404);
      let bytes;
      try { bytes = await readFile(path); } catch { throw new RequestError('文件不存在。', 404); }
      response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (!response.headersSent) json(response, error.status ?? 500, { error: error instanceof RequestError ? error.message : '服务暂时无法完成请求，请检查输入或重试。' });
      else response.end();
    }
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 4318;
  const server = createAppServer({ port });
  server.listen(port, '127.0.0.1', () => console.log(`FutureChain 量化模块已启动：http://127.0.0.1:${port}`));
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请更换 PORT。` : '量化模块无法启动，请检查本地端口。'); process.exitCode = 1; });
}
