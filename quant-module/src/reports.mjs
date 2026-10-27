import { deflateRawSync } from 'node:zlib';

const LABELS = {
  route:'数据获取方式', review:'人工审核记录', reviewedAt:'审核时间', materials:'从资料提取', online:'联网补齐', approved:'人工审核通过',
  industry: '研究行业', event: '事件描述', eventDescription: '事件描述', eventDate: '事件日期', asOf: '研究截止日', name: '名称', role: '环节角色', id: '企业标识',
  revenue: '基期收入', grossMargin: '基期毛利率', exposure: '原料成本暴露比例', rawMaterialShare: '原料成本占比', materialShare: '原料成本占比',
  priceShock: '原料价格冲击', demandShock: '需求变化', volumeChange: '销量变化', passThrough: '成本转嫁率', exposureRatio: '业务暴露比例',
  baseline: '基线', scenarios: '三情景', pessimistic: '悲观情景', base: '中性情景', optimistic: '乐观情景', status: '分析级别',
  summary: '主要结论', conclusions: '结论', warnings: '注意事项', gaps: '补数清单', missing: '缺失字段', assumptions: '关键假设',
  source: '来源', sources: '来源', evidence: '证据', locator: '页码 / 定位', publishedAt: '发布时间', period: '所属期间', unit: '单位',
  revenueChange: '收入变化', grossProfitChange: '毛利变化', grossMarginChange: '毛利率变化', grossProfit: '毛利',
  deltaRevenue: '收入变化', deltaGrossProfit: '毛利变化', deltaGrossMargin: '毛利率变化', methods: '方法', method: '方法',
  limitations: '适用边界', dataQuality: '数据充分性', direction: '影响方向', message: '说明', formula: '公式', value: '数值',
  window: '事件窗口', benchmarkCode: '市场基准', eventStudy: '市场事件研究', market: '市场反应', car: '累计异常收益（百分点）', aar: '平均异常收益（百分点）',
  version: '计算版本', schemaVersion: '契约版本', amountUnit: '金额单位', rawShock: '原料涨幅', volumeShock: '销量变化', pricingPower: '成本转嫁率',
  costs: '成本', fixedCosts: '固定成本', variableCosts: '变动成本', materialCosts: '原料成本', lagDays: '传导时滞（天）',
  shockPct: '原料 / 售价冲击（%）', volumePct: '销量变化（%）', passThroughPct: '成本转嫁率（%）', exposurePct: '业务暴露比例（%）',
  lagMonths: '传导时滞（月）', horizonMonths: '分析期限（月）', baselineRevenue: '基线收入（万元）', baselineGrossMarginPct: '基线毛利率（%）',
  rawMaterialCostSharePct: '原料占营业成本（%）', variableCostSharePct: '变动成本占营业成本（%）', fixedOperatingCost: '固定经营费用（万元）',
  headline: '主要结论', best: '相对最有利企业', worst: '相对最不利企业', grossProfitDelta: '毛利变化（万元）', missingCount: '待补数企业数',
  grossMarginPct: '毛利率（%）', grossMarginPp: '毛利率变化（百分点）', operatingProfit: '经营利润（万元）', operatingProfitPct: '经营利润变化（%）',
  cogs: '营业成本（万元）', rawShockExpense: '原料冲击增加成本（万元）', activeShare: '期限内生效比例', priceChangePct: '售价变化（%）',
  shockChannel: '冲击渠道', evidenceIds: '引用证据 ID', label: '名称', formulas: '计算公式', note: '说明', kind: '证据类型', periodLabel: '基线期间',
  parameters: '情景参数', inputs: '企业输入', delta: '相对基线变化', bridge: '毛利贡献分解', methodVersion: '计算版本', createdAt: '计算时间',
  provider: '行情提供方', interfaces: '数据接口', fetchedAt: '取数时间', params: '查询参数', dataProvenance: '行情数据来源', provenance: '计算口径',
  model: '所选模型', modelId: '模型标识', modelTitle: '模型名称', baselineSources: '字段来源', analysis: '分析设置', baselineReview: '用户确认的基准',
  confirmedAt: '确认时间', fields: '基准字段', companyId: '企业标识', field: '数据字段', evidenceId: '来源标识',
  breakEven: '盈亏平衡', fixedCost: '总固定经营成本', variableCost: '基线变动成本', contributionMarginPct: '贡献毛益率（%）',
  scope: '测算业务范围', level: '范围层级', product: '销售产品／业务', costItem: '具体成本项目', affected: '是否受事件影响', pricePct: '产品平均售价变化（%）', costPct: '成本单价变化（%）', fixedExpensePct: '额外固定经营费用变化（%）', eventMapping: '事件与参数审核', marketMethod: '预期收益方法', estimation: '事件前OLS估计', alpha: '每日α（%）', beta: 'β', rSquared: '估计窗口R平方', sampleDays: '样本日数',
  requiredVolumeChangePct: '达到盈亏平衡所需销量变化（%）', volumeIndex: '盈亏平衡销量倍数', safetyMarginPct: '安全边际率（%）',
};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const escapeXml = value => escapeHtml(String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''));
function printable(value) {
  if (value === null || value === undefined) return '未提供';
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.round(value * 1e6) / 1e6) : '无法计算';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function flatten(value, prefix = '', depth = 0) {
  if (value === null || typeof value !== 'object') return [[prefix || '值', printable(value)]];
  if (depth > 5) return [[prefix, printable(value).slice(0, 1200)]];
  return Object.entries(value).flatMap(([key, item]) => {
    if (['prices', 'benchmark', 'charts', 'png', 'token', 'apiKey', 'TUSHARE_TOKEN'].includes(key)) return [];
    const label = prefix ? `${prefix} · ${LABELS[key] ?? key}` : LABELS[key] ?? key;
    if (Array.isArray(item)) {
      if (!item.length) return [[label, '无']];
      return item.slice(0, 40).flatMap((entry, index) => flatten(entry, `${label} ${index + 1}`, depth + 1));
    }
    return flatten(item, label, depth + 1);
  });
}
function evidenceLinks(...objects) {
  const found = new Map();
  function visit(object, path = '', depth = 0) {
    if (!object || typeof object !== 'object' || depth > 8) return;
    if (Array.isArray(object)) { object.slice(0, 100).forEach((item, index) => visit(item, `${path} ${index + 1}`, depth + 1)); return; }
    const url = safeUrl(object.url ?? object.link ?? object.sourceUrl);
    if (url && !found.has(url)) found.set(url, { url, title: object.title ?? object.name ?? object.provider ?? '原始来源', locator: object.locator ?? object.page ?? object.field ?? '', publishedAt: object.publishedAt ?? object.date ?? '', path });
    for (const [key, item] of Object.entries(object)) if (!['prices', 'benchmark', 'png', 'charts', 'token', 'apiKey'].includes(key)) visit(item, `${path} ${LABELS[key] ?? key}`.trim(), depth + 1);
  }
  objects.forEach(object => visit(object));
  return [...found.values()].slice(0, 100);
}
function chartImages(charts) {
  if (!Array.isArray(charts)) return [];
  return charts.slice(0, 3).flatMap((chart, index) => {
    if (!chart || typeof chart.png !== 'string' || chart.png.length > 1100000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(chart.png)) return [];
    const bytes = Buffer.from(chart.png, 'base64');
    if (bytes.length < 24 || bytes.length > 800000 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return [];
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || !height || width > 10000 || height > 10000) return [];
    return [{ title: typeof chart.title === 'string' ? chart.title.slice(0, 150) : `量化图表 ${index + 1}`, bytes, width, height }];
  });
}
function sectionsFor({ input, result, marketResult, detail, charts }) {
  const sections = [];
  const heading = (text, level = 1) => sections.push({ kind: 'heading', text, level });
  const paragraph = text => sections.push({ kind: 'paragraph', text: printable(text) });
  const table = (rows, headers = ['项目', '内容']) => { if (rows.length) sections.push({ kind: 'table', rows: [headers, ...rows] }); };
  heading('FutureChain 产业链量化研究报告');
  paragraph(`${detail === 'brief' ? '简版' : '详版'} · 生成时间 ${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}`);
  const context = input.context ?? input;
  table(['industry', context.eventDescription !== undefined ? 'eventDescription' : 'event', 'eventDate', 'asOf'].filter(key => context[key] !== undefined).map(key => [LABELS[key], printable(context[key])]));
  if (result.modelTitle) paragraph(`所选量化模型：${result.modelTitle}（${result.modelId}） · 方法版本 ${result.methodVersion}`);
  heading('基准设置与用户确认', 2);
  paragraph(input.analysis?.baselineReview ? '用户已确认期间、单位与业务范围。确认不代表系统已独立核验真实性；参考值与假设仍保留原标签。' : '未提供用户确认记录；此报告基于调用方提交的数据，须核查基准。');
  table([['基准期间', result.modelId === 'event_study' ? `行情窗口 T−${result.marketStudy?.window.before ?? '?'} 至 T+${result.marketStudy?.window.after ?? '?'}；不使用财务基线` : printable(context.periodLabel)], ['用户确认时间', printable(input.analysis?.baselineReview?.confirmedAt)]]);
  if (result.modelId === 'event_study') {
    const market = result.marketStudy ?? marketResult;
    if (!market) { paragraph('没有市场计算结果，不能生成市场结论。'); return sections; }
    const provenance = marketResult?.dataProvenance ?? {}, kind = provenance.kind;
    heading('主要结论与全部证券结果', 2);
    paragraph(result.summary?.headline ?? '市场事件研究结果');
    paragraph('每一行是一只证券的实际可用日收益样本；组合只使用共同日期等权计算。有缺口时，证券CAR均值不一定等于组合CAR。CAR为百分点，不是经营利润或复利收益。');
    table(market.companies.map(c => [c.name, c.id, printable(c.car), `${c.sampleDays}/${c.expectedDays}`, c.status, printable(c.volumeZ), printable(c.maxDrawdown)]), ['证券样本', '标识', 'CAR（pp）', '有效／目标日数', '样本状态', '成交量Z', '最大回撤（%）']);
    const last = market.series.at(-1);
    table([['组合窗口末CAR（pp）', printable(last?.car)], ['组合累计收益（%）', printable(last?.portfolioCumulative)], ['基准累计收益（%）', printable(last?.benchmarkCumulative)], ['共同有效日数', String(market.series.length)]]);
    heading('证券、基准、来源与窗口快照', 2);
    table([
      ['预期收益方法', market.method], ['事件对齐交易日T0', printable(market.tradingEventDate)],
      ['事件窗口', `T−${market.window.before} 至 T+${market.window.after}；${market.window.startDate ?? '无'} 至 ${market.window.endDate ?? '无'}`],
      ['行情提供方', printable(provenance.provider ?? '未提供，请核对行情来源')],
      ['基准代码／口径', printable(provenance.params?.benchmarkCode ?? provenance.benchmarkCode ?? (kind === 'assumption' ? '演示合成基准，无真实指数代码' : '导入基准序列，代码未标明'))],
      ['行情类型', kind === 'assumption' ? '演示或研究假设（非真实市场数据）' : kind === 'user' ? '用户导入（待核验）' : kind === 'observed' ? '接口取得的已观测行情' : '来源类型未注明'],
      ['来源说明', printable(provenance.description ?? '请核对原始行情来源和口径')],
    ]);
    paragraph('数值由提交的价格序列重新计算，不采信调用方提交的结论。导出时未重新请求市场接口；来源标签是数据提供方的声明，并非系统独立验证。待查询代码不属于当前已载入样本。');
    heading('方法、假设与适用边界', 2);
    paragraph(market.expectedReturnModel === 'market_model' ? 'OLS市场模型：事件窗口前、最多120个共同日收益拟合 rᵢ,t = αᵢ + βᵢrₘ,t + εᵢ,t，至少20日且基准有波动；ARᵢ,t = rᵢ,t − (αᵢ + βᵢrₘ,t)。估计不足不回退为其他方法。' : '市场调整法：假设α=0、β=1；ARᵢ,t = rᵢ,t − rₘ,t。');
    paragraph('CARᵢ = Σ窗口实际日ARᵢ,t；组合每日AR等权，组合CAR只在固定有效样本的共同日期加总。累计收益 = [Π(1+rₜ/100)−1]×100，与CAR不同。');
    table(flatten(market.provenance));
    if (market.expectedReturnModel === 'market_model') table(market.companies.map(c => [c.name, printable(c.estimation?.alpha), printable(c.estimation?.beta), printable(c.estimation?.rSquared), printable(c.estimation?.sampleDays), c.estimation ? `${c.estimation.startDate} 至 ${c.estimation.endDate}` : 'OLS不可用，不作替代估计']), ['证券', '每日α（%）', 'β', 'R²', '估计日数', '事件前估计窗口']);
    paragraph('本版不提供统计显著性、因果识别或未来收益预测。需核查基准匹配、除权除息、停牌、同步政策及样本选择。不得把CAR当作企业盈利变化。');
    const images = chartImages(charts);
    if (images.length) { heading('核心可视化', 2); for (const image of images) { sections.push({ kind: 'image', ...image }); paragraph(`图：${image.title}；使用本次确认的行情、窗口和预期收益方法。缺失收益不按零处理。`); } }
    heading('数据缺口与警告', 2);
    market.warnings.length ? market.warnings.forEach(paragraph) : paragraph('本次计算未发现窗口缺口；这不代表来源已独立核验或事件已作因果识别。');
    heading('来源与可复核证据', 2);
    const links = evidenceLinks(provenance, market.provenance);
    if (!links.length) paragraph('本次行情快照没有原文链接。合成行情仅用于演示；导入数据需补充行情提供方、复权口径、取数日期和基准身份。未参与市场计算的经营资料不列入本报告。');
    links.forEach(link => { paragraph(`${link.title}｜${link.locator}`); sections.push({ kind: 'link', text: link.url, url: link.url }); });
    heading('持续监测与下一步补证', 2);
    paragraph('跟踪后续交易日AR／CAR是否延续或反转；比较不同窗口与合理基准，但避免事后挑选最有利结果。优先补齐缺失收盘价及复权因子、停牌和同步公告；OLS需检查估计窗口稳定性。市场反应与利润影响须分别验证。');
    if (detail === 'full') {
      heading('逐证券每日计算明细', 2);
      paragraph('以下按每只证券分别列出全部有效日，无统一行数截断。百分数单位为%，AR／CAR为pp；缺失日期另列，不补零。');
      for (const c of market.companies) {
        heading(`${c.name}（${c.id}）`, 3);
        table(c.daily.map(r => [r.date, `T${r.day > 0 ? '+' : ''}${r.day}`, printable(r.stock), printable(r.benchmark), printable(r.stock - r.abnormal), printable(r.abnormal)]), ['日期', '交易日', '实际收益（%）', '基准收益（%）', '预期收益（%）', 'AR（pp）']);
        paragraph(`缺失日：${c.missingDates.length ? c.missingDates.join('、') : '无'}；窗口CAR=${printable(c.car)} pp。`);
      }
      heading('组合共同日期明细', 2);
      table(market.series.map(r => [r.date, printable(r.n), printable(r.abnormal), printable(r.car), printable(r.portfolioCumulative), printable(r.benchmarkCumulative)]), ['日期', '固定样本数', '组合AR（pp）', '累计CAR（pp）', '组合累计收益（%）', '基准累计收益（%）']);
      table(flatten({ dataProvenance: provenance, methodVersion: market.methodVersion, createdAt: result.createdAt }));
    }
    return sections;
  }
  if (input.analysis?.baselineReview?.fields?.length) table(input.analysis.baselineReview.fields.map(field => {
    const company = input.companies.find(item => item.id === field.companyId), source = input.evidence?.find(item => item.id === field.evidenceId);
    return [company?.name || field.companyId, LABELS[field.field] || field.field, printable(field.value), field.review?.status==='approved'?'参考资料·人工审核（未独立核验）':{ user: '用户填写·待核验', reference: '参考资料·待核验', assumption: '情景假设' }[field.kind] || '来源未标明', source ? `${source.source}；${source.publishedAt || '未提供披露日'}；${source.locator || '未定位'}${field.review?`；人工审核 ${field.review.reviewedAt}`:''}` : '未绑定资料'];
  }), ['企业', '基准指标', '数值', '数据属性', '来源／披露日／口径']);
  heading('主要结论', 2);
  const summary = result.summary ?? result.conclusions ?? result.conclusion ?? result;
  if (result.modelId === 'break_even') {
    paragraph('本模型以经营利润、盈亏门槛和安全边际为主；均为当前价格／成本／费用假设下的测算，不是净利润或盈利预测。');
    table(result.companies.map(c => [c.name, printable(c.scenario?.operatingProfit), c.breakEven?.revenue == null ? '无有限正向门槛' : printable(c.breakEven.revenue), printable(c.breakEven?.requiredVolumeChangePct), printable(c.breakEven?.safetyMarginPct)]), ['对象', '情景经营利润（万元）', '盈亏平衡收入（万元）', '门槛销量变化（%）', '当前安全边际（%）']);
  } else if (typeof summary === 'string') paragraph(summary);
  else table(flatten(summary).slice(0, 35));
  const companyResults = result.companies ?? result.companyResults ?? result.results;
  if (Array.isArray(companyResults)) {
    heading('企业经营影响与情景比较', 2);
    companyResults.forEach((company, index) => {
      heading(`${company.name ?? company.id ?? `企业 ${index + 1}`} · ${company.role ?? '样本'}`, 3);
      if (company.scope) table(flatten({ scope: company.scope, affected: company.affected, parameters: company.parameters }));
      if (company.status === 'missing') table(flatten({ status: '无法计算：关键输入缺失', missing: company.missing, limitations: company.limitations }));
      else if (company.baseline && company.scenario && company.delta) {
        const monetary = value => typeof value === 'number' ? `${Math.round(value * 100) / 100} 万元` : '未提供';
        const percent = value => typeof value === 'number' ? `${Math.round(value * 100) / 100}%` : '未提供';
        table([
          ['收入', monetary(company.baseline.revenue), monetary(company.scenario.revenue), monetary(company.delta.revenue)],
          ['营业成本', monetary(company.baseline.cogs), monetary(company.scenario.cogs), monetary(company.scenario.cogs - company.baseline.cogs)],
          ['毛利', monetary(company.baseline.grossProfit), monetary(company.scenario.grossProfit), monetary(company.delta.grossProfit)],
          ['毛利率', percent(company.baseline.grossMarginPct), percent(company.scenario.grossMarginPct), `${printable(company.delta.grossMarginPp)} 个百分点`],
          ...(company.baseline.operatingProfit !== undefined ? [['经营利润', monetary(company.baseline.operatingProfit), monetary(company.scenario.operatingProfit), monetary(company.delta.operatingProfit)]] : []),
        ], ['指标', '基线', '当前情景', '变化']);
        if (detail === 'full') {
          table((company.bridge ?? []).map(part => [part.label, monetary(part.value)]), ['毛利贡献项目', '变化金额']);
          table(flatten({ assumptions: company.limitations, evidenceIds: company.evidenceIds }));
        }
        if (company.breakEven) {
          heading('本量利／盈亏平衡', 3);
          paragraph('盈亏平衡指模型经营利润为零，不是净利润；销量使用相对基线指数。贡献毛益非正时不输出有限正向门槛。');
          table(flatten(company.breakEven));
        }
      } else table(flatten(company).slice(0, detail === 'brief' ? 20 : 100));
    });
  } else if (result.scenarios) { heading('情景比较', 2); table(flatten(result.scenarios)); }
  if (Array.isArray(result.scenarios) && Array.isArray(companyResults)) {
    heading('三情景压力测试', 2);
    paragraph('三情景为人为设定的参数组合；以下范围不代表统计置信区间或发生概率。金额单位为万元。');
    const stressTarget = result.modelId === 'break_even' ? 'operatingProfit' : 'grossProfit';
    const stressLabel = stressTarget === 'operatingProfit' ? '经营利润变化' : '毛利变化';
    table(companyResults.map(company => [company.name, ...result.scenarios.map(scenario => {
      const match = scenario.companies?.find(item => item.id === company.id);
      return match?.delta ? printable(match.delta[stressTarget]) : '待补数';
    })]), ['企业', ...result.scenarios.map(scenario => `${scenario.label}：${stressLabel}`)]);
    if (detail === 'full') result.scenarios.forEach(scenario => {
      heading(scenario.label, 3);
      table(flatten({ parameters: scenario.parameters, note: scenario.note }));
    });
  }
  const images = chartImages(charts);
  if (images.length) {
    heading('核心可视化', 2);
    for (const image of images) { sections.push({ kind: 'image', ...image }); paragraph(`图：${image.title}。图中情景取值对应本次导出参数快照。`); }
  }
  heading('参数快照与分析假设', 2);
  const activeKeys = result.modelId === 'event_study' ? [] : ['volume_price', 'break_even'].includes(result.modelId) ? ['shockPct', 'volumePct'] : null;
  const activeParameters = input.analysis?.scenarioMode === 'entity' ? { horizonMonths: input.parameters?.horizonMonths, note: '逐对象冲击见各企业参数；旧版全局冲击不参与本次计算。' } : activeKeys ? Object.fromEntries(activeKeys.map(key => [key, input.parameters[key]])) : input.parameters ?? input.scenario ?? input.controls ?? {};
  table(flatten({ parameters: activeParameters, assumptions: result.assumptions ?? input.assumptions ?? [] }));
  const gaps = result.gaps ?? result.missing ?? result.warnings ?? [];
  heading('数据缺口与适用边界', 2);
  table(flatten({ gaps, limitations: result.limitations ?? ['经营结果是给定输入和假设下的情景计算，不是已实现盈利。', '市场事件研究描述相对基准的反应，不能直接识别企业利润或事件因果效果。', '演示数据与假设须经真实资料替换后用于研究。'] }));
  const links = evidenceLinks(input, result);
  heading('来源与可复核证据', 2);
  if (Array.isArray(input.evidence)) input.evidence.forEach(item => {
    paragraph(`${item.id ?? ''} · ${item.title ?? item.name ?? '资料 / 假设'}`);
    table([
      ['证据类型', item.kind === 'observed' ? '已观测' : item.kind === 'user' ? '用户资料（待核验）' : '演示或研究假设'],
      ['原始来源', printable(item.source ?? '未提供')],
      ['描述 / 适用内容', printable(item.description ?? item.note ?? '未提供')],
      ['页码 / 字段定位', printable(item.locator ?? '未提供')],
      ['发布时间', printable(item.publishedAt ?? '未提供')],
    ]);
  });
  if (!links.length) paragraph('当前快照未提供可点击的原文链接。请补充来源、发布时间、所属期间与页码 / 字段定位；不以文件数量代表证据完整性。');
  links.forEach(link => { paragraph(`${link.title}｜${link.locator ? `定位：${link.locator}｜` : ''}${link.publishedAt ? `发布时间：${link.publishedAt}｜` : ''}${link.path}`); sections.push({ kind: 'link', text: link.url, url: link.url }); });
  heading('持续监测与下一步补证', 2);
  paragraph('持续核对原料实际采购价、订单 / 销量、产品提价幅度及生效时间。发现输入与最新资料不一致时，应更新参数并复算；毛利率变化须与同口径财报对照。缺少成本或业务暴露证据的企业，优先补充财报业务构成、采购协议、产能和成本结构。');
  if (detail === 'full') {
    heading('方法与计算口径', 2);
    for (const method of result.methods ?? []) {
      heading(method.label ?? method.id ?? '量化方法', 3);
      paragraph(`计算版本：${method.version ?? result.methodVersion ?? '未提供'}`);
      (method.formulas ?? []).forEach(formula => paragraph(formula));
      table(flatten({ assumptions: method.assumptions ?? [] }));
    }
    if (Array.isArray(result.sensitivity) && result.sensitivity.length) {
      heading('单参数敏感性', 2);
      paragraph('每次仅改变一个参数，其余参数保持当前值；不同参数的变化范围由测试设定，不代表出现概率。');
      const targetLabel = result.sensitivity[0].target === 'operatingProfit' ? '经营利润' : '毛利';
      table(result.sensitivity.map(item => [item.label ?? item.key, printable(item.low), printable(item.high), printable(item.lowDelta), printable(item.highDelta)]), ['参数', '低值', '高值', `低值${targetLabel}变化（万元）`, `高值${targetLabel}变化（万元）`]);
    }
    heading('企业输入与证据定位', 2);
    paragraph('金额与成本结构属于上述基线期间；模型不自动年化。下表保存计算输入，未提供的字段保留为缺口。');
    for (const company of input.companies ?? []) {
      heading(company.name ?? company.id ?? '企业', 3);
      table(flatten(company).slice(0, 80));
    }
    table(flatten({ schemaVersion: input.schemaVersion, methodVersion: result.methodVersion, periodLabel: context.periodLabel, amountUnit: '万元', createdAt: result.createdAt, warnings: result.warnings ?? [] }));
  }
  return sections;
}
function htmlReport(sections) {
  const html = sections.map(section => {
    if (section.kind === 'heading') return `<h${section.level}>${escapeHtml(section.text)}</h${section.level}>`;
    if (section.kind === 'paragraph') return `<p>${escapeHtml(section.text)}</p>`;
    if (section.kind === 'link') return `<p><a href="${escapeHtml(section.url)}" rel="noopener noreferrer">${escapeHtml(section.text)}</a></p>`;
    if (section.kind === 'image') return `<figure><img src="data:image/png;base64,${section.bytes.toString('base64')}" alt="${escapeHtml(section.title)}"><figcaption>${escapeHtml(section.title)}</figcaption></figure>`;
    if (section.kind === 'table') return `<table>${section.rows.map((row, i) => `<tr>${row.map(cell => `<${i ? 'td' : 'th'}>${escapeHtml(cell)}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</table>`;
    return '';
  }).join('\n');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FutureChain 量化报告</title><style>body{max-width:960px;margin:40px auto;padding:0 24px;color:#192a37;font:15px/1.7 system-ui,"Microsoft YaHei",sans-serif}h1{font-size:28px;color:#087f7a}h2{margin-top:32px;border-bottom:2px solid #dcecec;padding-bottom:8px}h3{font-size:18px}table{border-collapse:collapse;width:100%;font-size:13px;margin:16px 0;table-layout:fixed}td,th{border:1px solid #dce4e8;padding:9px;text-align:left;overflow-wrap:anywhere}th{background:#eaf7f5}p{white-space:pre-wrap;overflow-wrap:anywhere}img{max-width:100%;height:auto}figcaption{color:#607985;font-size:13px}a{color:#087f7a}@media print{body{margin:0}tr,img{break-inside:avoid}}</style><body>${html}</body></html>`;
}
function markdownReport(sections) {
  const cell = value => String(value).replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
  return sections.map(section => {
    if (section.kind === 'heading') return `${'#'.repeat(section.level)} ${section.text}\n`;
    if (section.kind === 'table') return `${section.rows[0].map(cell).join(' | ')}\n${section.rows[0].map(() => '---').join(' | ')}\n${section.rows.slice(1).map(row => row.map(cell).join(' | ')).join('\n')}\n`;
    if (section.kind === 'link') return `[原始来源](${section.url})\n`;
    if (section.kind === 'image') return `图表：${section.title}（图像嵌入请选 Word 或 HTML 导出）\n`;
    return `${section.text}\n`;
  }).join('\n');
}
const crcTable = new Uint32Array(256).map((_, number) => {
  let crc = number;
  for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const filename = Buffer.from(name), data = Buffer.isBuffer(content) ? content : Buffer.from(content), compressed = deflateRawSync(data), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(33, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(33, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const centralBytes = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}
function docxReport(sections) {
  const files = {}, relations = [];
  const run = text => `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
  const paragraph = (text, style = '') => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${run(text)}</w:p>`;
  let imageIndex = 0;
  const document = sections.map(section => {
    if (section.kind === 'heading') return paragraph(section.text, `Heading${section.level}`);
    if (section.kind === 'paragraph') return paragraph(section.text);
    if (section.kind === 'link') {
      const id = `link${relations.length + 1}`;
      relations.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(section.url)}" TargetMode="External"/>`);
      return `<w:p><w:hyperlink r:id="${id}"><w:r><w:rPr><w:color w:val="087F7A"/><w:u w:val="single"/></w:rPr><w:t>${escapeXml(section.text)}</w:t></w:r></w:hyperlink></w:p>`;
    }
    if (section.kind === 'table') return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => `<w:${side} w:val="single" w:sz="4" w:color="DCE4E8"/>`).join('')}</w:tblBorders></w:tblPr><w:tblGrid>${section.rows[0].map(() => `<w:gridCol w:w="${Math.floor(9360 / section.rows[0].length)}"/>`).join('')}</w:tblGrid>${section.rows.map((row, index) => `<w:tr>${index === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${row.map(value => `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9360 / row.length)}" w:type="dxa"/>${index === 0 ? '<w:shd w:fill="EAF7F5"/>' : ''}</w:tcPr>${paragraph(value)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>${paragraph('')}`;
    if (section.kind === 'image') {
      imageIndex++;
      const id = `image${imageIndex}`;
      files[`word/media/${id}.png`] = section.bytes;
      relations.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${id}.png"/>`);
      const scale = Math.min(5943600 / section.width, 8000000 / section.height);
      const cx = Math.round(section.width * scale), cy = Math.round(section.height * scale);
      return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imageIndex}" name="${escapeXml(section.title)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${imageIndex}" name="${id}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    }
    return '';
  }).join('');
  files['[Content_Types].xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  files['_rels/.rels'] = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  files['word/_rels/document.xml.rels'] = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${relations.join('')}</Relationships>`;
  files['word/styles.xml'] = `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="280" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>${[1, 2, 3].map(level => `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="087F7A"/><w:sz w:val="${level === 1 ? 34 : level === 2 ? 26 : 23}"/></w:rPr></w:style>`).join('')}</w:styles>`;
  files['word/document.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${document}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1100" w:right="1273" w:bottom="1100" w:left="1273"/></w:sectPr></w:body></w:document>`;
  return zip(files);
}
export function buildReport(payload) {
  const sections = sectionsFor(payload);
  if (payload.format === 'docx') return { buffer: docxReport(sections), mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: 'docx' };
  if (payload.format === 'html') return { buffer: Buffer.from(htmlReport(sections)), mime: 'text/html; charset=utf-8', extension: 'html' };
  return { buffer: Buffer.from(markdownReport(sections)), mime: 'text/markdown; charset=utf-8', extension: 'md' };
}
