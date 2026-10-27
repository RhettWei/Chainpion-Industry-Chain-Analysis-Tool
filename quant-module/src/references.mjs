import { BASELINE_FIELDS } from './models.mjs';

const plain = value => String(value ?? '').replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#39);/g, match => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[match])).slice(0, 1200);
const iso = value => /^\d{8}$/.test(String(value)) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null;
function date(value) { const parsed = new Date(`${value}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function safeUrl(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } }
function primaryUrl(value) { const host = new URL(value).hostname; return /(?:^|\.)(?:cninfo\.com\.cn|sse\.com\.cn|szse\.cn|bse\.cn|gov\.cn)$/.test(host); }

export async function findBaselineReferences(body, { fetchImpl = fetch, token = '', searchKey = '', timeoutMs = 25000 } = {}) {
  if (!BASELINE_FIELDS[body.field]) fail('请选择有效的基准数据字段。');
  if (typeof body.companyName !== 'string' || !body.companyName.trim() || body.companyName.length > 300) fail('请填写需要查找的企业名称。');
  if (body.scope && (!['company','segment','product'].includes(body.scope.level) || typeof body.scope.product !== 'string' || body.scope.product.length > 300)) fail('业务范围格式无效。');
  if (!date(body.asOf)) fail('请先设置有效的研究截止日。');
  if (body.periodEnd && (!date(body.periodEnd) || !/(?:03-31|06-30|09-30|12-31)$/.test(body.periodEnd))) fail('财报期末须为季末日期，例如 2025-12-31。');
  if (body.periodEnd && body.periodEnd > body.asOf) fail('基线财报期末晚于研究截止日。');
  if (body.code && !/^\d{6}\.(SH|SZ|BJ)$/.test(body.code)) fail('财报查询证券代码应为 300750.SZ 一类格式。');
  const requestToken = typeof body.token === 'string' && body.token.trim() ? body.token.trim() : token;
  const requestSearchKey = typeof body.searchKey === 'string' && body.searchKey.trim() ? body.searchKey.trim() : searchKey;
  for (const key of [requestToken, requestSearchKey]) if (key && (typeof key !== 'string' || key.length > 512 || /[\r\n]/.test(key))) fail('连接凭证格式无效。');
  const candidates = [], warnings = [], usage = { requests: 0, cacheHits: 0 }, fetchedAt = new Date().toISOString();
  async function request(url, options) {
    usage.requests++;
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error('upstream');
    return response.json();
  }
  if (body.code && body.periodEnd && ['baselineRevenue', 'baselineGrossMarginPct'].includes(body.field) && (!body.scope || body.scope.level === 'company')) {
    if (!requestToken) warnings.push('财报查询尚未配置 Tushare Token。可在下方填写临时凭证。');
    else try {
      const data = await request('https://api.tushare.pro', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ api_name: 'income', token: requestToken,
        params: { ts_code: body.code, period: body.periodEnd.replaceAll('-', ''), report_type: '1' }, fields: 'ts_code,ann_date,f_ann_date,end_date,report_type,comp_type,revenue,oper_cost' }) });
      if (data.code !== 0) throw new Error(/权限|积分|permission/i.test(String(data.msg)) ? 'permission' : 'upstream');
      if (!Array.isArray(data.data?.fields) || !Array.isArray(data.data?.items)) throw new Error('upstream');
      const rows = data.data.items.map(row => Object.fromEntries(data.data.fields.map((field, index) => [field, row[index]])))
        .filter(row => row.ts_code === body.code && iso(String(row.end_date)) === body.periodEnd && String(row.report_type) === '1'
          && String(row.comp_type) === '1' && iso(String(row.f_ann_date || row.ann_date)) && iso(String(row.f_ann_date || row.ann_date)) <= body.asOf)
        .sort((a, b) => String(b.f_ann_date || b.ann_date).localeCompare(String(a.f_ann_date || a.ann_date)));
      const row = rows[0];
      if (!row) warnings.push('未取得截止日之前披露的普通工商业合并财报；金融企业、其他期间和期后资料不会拿来替代。');
      else {
        const revenue = row.revenue == null ? NaN : Number(row.revenue), cogs = row.oper_cost == null ? NaN : Number(row.oper_cost);
        const value = body.field === 'baselineRevenue' ? revenue / 10000 : (revenue - cogs) / revenue * 100;
        if (!(revenue > 0) || !Number.isFinite(value) || (body.field === 'baselineGrossMarginPct' && (!Number.isFinite(cogs) || cogs < 0 || value < -100 || value > 100))) warnings.push('接口缺少有效营业收入或营业成本，未输出零值或替代指标。');
        else candidates.push({ id: 'income-reference', field: body.field, value, unit: BASELINE_FIELDS[body.field].unit, period: body.periodEnd,
          publishedAt: iso(String(row.f_ann_date || row.ann_date)), source: `Tushare Pro · income · ${body.code}`, url: 'https://tushare.pro/document/2?doc_id=33',
          locator: `ts_code=${body.code}; end_date=${row.end_date}; report_type=1; ${body.field === 'baselineRevenue' ? 'revenue / 10000（元转万元）' : '(revenue − oper_cost) / revenue × 100'}`,
          description: '累计合并报表口径，年度／半年／前三季度／一季度取决于期末。链接为接口说明，不是原始年报；采用前应对照公告核验业务范围、期间及金额单位。最新报表接口可能含事后修订，不保证历史时点版本。', status: 'reference' });
      }
    } catch (error) { warnings.push(error.message === 'permission' ? '账号未开通 Tushare income 接口，请核对权限。' : 'Tushare 财报查询未完成（网络、超时、频率或账号状态）；原有输入不受影响。'); }
  }
  if (body.scope && body.scope.level !== 'company') warnings.push('当前为产品／分部范围，不采用Tushare公司合并财报充当该业务基线；请搜索分部披露或上传同范围资料。');
  const query = [body.companyName.trim(), body.scope?.product || '', String(body.industry || '').slice(0, 300), body.periodEnd || '', BASELINE_FIELDS[body.field].label,
    body.primaryOnly !== false ? '(site:cninfo.com.cn OR site:sse.com.cn OR site:szse.cn OR site:gov.cn)' : '年报 调研 成本结构'].join(' ');
  if (requestSearchKey) try {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query); url.searchParams.set('count', '8');
    const data = await request(url.href, { headers: { Accept: 'application/json', 'X-Subscription-Token': requestSearchKey } });
    for (const [index, result] of (Array.isArray(data.web?.results) ? data.web.results : []).slice(0, 8).entries()) {
      const sourceUrl = safeUrl(result.url); if (!sourceUrl || (body.primaryOnly !== false && !primaryUrl(sourceUrl))) continue;
      candidates.push({ id: `web-${index}`, field: body.field, unit: BASELINE_FIELDS[body.field].unit, source: new URL(sourceUrl).hostname,
        url: sourceUrl, title: plain(result.title), description: plain(result.description), locator: '网页搜索摘要；未核验正文、数值与披露日', status: 'reference' });
    }
    if (!data.web?.results?.length) warnings.push('本次网页搜索没有返回结果。可调整企业名称、期间或关闭官方来源筛选。');
  } catch { warnings.push('Brave 搜索未完成，请核对搜索 Key、额度及网络。不会用模型知识冒充联网结果。'); }
  else warnings.push('通用网页检索需要 Brave Search API Key（不是模型 API Key）。未配置时仅查询可用财报，下列外部检索入口不是已搜索到的资料。');
  return { candidates, query, fetchedAt, usage, warnings,
    manualLinks: [{ title: '在浏览器中搜索参考资料', url: `https://www.bing.com/search?q=${encodeURIComponent(query)}` }, { title: '巨潮资讯：查找原始公告', url: 'https://www.cninfo.com.cn/' }],
    note: '参考值及搜索摘要都待用户核验；不会自动写入基线。无法从公开财报直接识别原料／变动成本占比或固定经营费用时，须补充资料或明确记录研究假设。' };
}
