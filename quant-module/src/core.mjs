// Deterministic calculations. All money uses the caller's aligned period and 万元.
export const METHOD_VERSION = '1.0.0';

const PARAMETER_RANGES = {
  shockPct: [-90, 200], volumePct: [-90, 100], passThroughPct: [0, 100],
  exposurePct: [0, 100], lagMonths: [0, 36], horizonMonths: [1, 36],
};
const COMPANY_RANGES = {
  baselineRevenue: [Number.MIN_VALUE, 1e15], baselineGrossMarginPct: [-100, 100],
  rawMaterialCostSharePct: [0, 100], variableCostSharePct: [0, 100],
};
const FIELD_LABELS = {
  baselineRevenue: '基线收入', baselineGrossMarginPct: '基线毛利率',
  rawMaterialCostSharePct: '原料占营业成本比例', variableCostSharePct: '变动成本占营业成本比例',
};
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);
const missingValue = value => value === null || value === undefined || value === '';
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function validateInput(input) {
  const errors = [], warnings = [], missing = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, errors: ['输入必须为对象。'], warnings, missing };
  }
  if (input.schemaVersion !== '1.0') errors.push('schemaVersion 必须为 1.0。');
  for (const field of ['eventDate', 'asOf']) {
    if (!isDate(input.context?.[field])) errors.push(`context.${field} 必须为有效的 YYYY-MM-DD 日期。`);
  }
  if (!input.context?.periodLabel?.trim?.()) errors.push('必须明确基线期间 periodLabel；不自动年化。');
  if (!input.context?.industry?.trim?.()) errors.push('必须明确研究行业 industry。');
  for (const [field, [low, high]] of Object.entries(PARAMETER_RANGES)) {
    const value = input.parameters?.[field];
    if (!isFiniteNumber(value) || value < low || value > high) {
      errors.push(`parameters.${field} 必须为 ${low} 至 ${high} 范围内的有限数值。`);
    }
  }
  for (const field of ['lagMonths', 'horizonMonths']) {
    if (isFiniteNumber(input.parameters?.[field]) && !Number.isInteger(input.parameters[field])) errors.push(`parameters.${field} 必须为整数月份。`);
  }
  if (!Array.isArray(input.companies)) errors.push('companies 必须为数组；尚未选定企业时可提供空数组。');
  else if (!input.companies.length) warnings.push('尚未选定企业，先补充目标企业及经营基线后再计算。');
  else if (input.companies.length > 100) errors.push('单次分析最多 100 家企业。');
  const ids = new Set();
  for (const [index, company] of (Array.isArray(input.companies) ? input.companies : []).entries()) {
    if (!company || typeof company !== 'object') { errors.push(`companies[${index}] 必须为对象。`); continue; }
    const label = company.name || company.id || `企业 ${index + 1}`;
    if (!company.id || typeof company.id !== 'string' || ids.has(company.id)) errors.push(`${label} 的企业 ID 缺失或重复。`);
    ids.add(company.id);
    if (!company.name || typeof company.name !== 'string') errors.push(`${label} 缺少企业名称。`);
    if (!['cost', 'selling_price'].includes(company.shockChannel)) errors.push(`${label} 的 shockChannel 必须为 cost 或 selling_price。`);
    const fields = [];
    for (const [field, [low, high]] of Object.entries(COMPANY_RANGES)) {
      const value = company[field];
      if (missingValue(value)) fields.push(field);
      else if (!isFiniteNumber(value) || value < low || value > high) errors.push(`${label} 的 ${FIELD_LABELS[field]}不在有效范围内。`);
    }
    if (fields.length) missing.push({ id: company.id, name: label, fields });
    if (!missingValue(company.fixedOperatingCost) && (!isFiniteNumber(company.fixedOperatingCost) || company.fixedOperatingCost < 0)) {
      errors.push(`${label} 的固定经营费用必须为非负有限数值。`);
    }
    if (isFiniteNumber(company.rawMaterialCostSharePct) && isFiniteNumber(company.variableCostSharePct)
      && company.rawMaterialCostSharePct > company.variableCostSharePct) {
      errors.push(`${label} 的原料成本比例不能超过变动成本比例；原料视为变动成本的一部分。`);
    }
    if (company.evidenceIds !== undefined && !Array.isArray(company.evidenceIds)) errors.push(`${label} 的 evidenceIds 必须为数组。`);
  }
  if (input.evidence !== undefined && !Array.isArray(input.evidence)) errors.push('evidence 必须为数组。');
  const evidenceIds = new Set();
  for (const evidence of (Array.isArray(input.evidence) ? input.evidence : [])) {
    if (!evidence || typeof evidence !== 'object') { errors.push('证据条目必须为对象。'); continue; }
    if (!evidence.id || typeof evidence.id !== 'string' || evidenceIds.has(evidence.id)) errors.push('证据 ID 缺失或重复。');
    evidenceIds.add(evidence.id);
    if (!['observed', 'assumption', 'user'].includes(evidence.kind)) errors.push(`证据 ${evidence.id} 的 kind 无效。`);
    if (evidence.publishedAt && !isDate(evidence.publishedAt)) errors.push(`证据 ${evidence.id} 的 publishedAt 日期无效。`);
    if (isDate(evidence.publishedAt) && isDate(input.context?.asOf) && evidence.publishedAt > input.context.asOf) {
      warnings.push(`证据 ${evidence.id} 发布于研究截止日之后，不能用于当时可知信息的回测。`);
    }
  }
  for (const company of (Array.isArray(input.companies) ? input.companies : [])) {
    for (const id of (Array.isArray(company?.evidenceIds) ? company.evidenceIds : [])) {
      if (!evidenceIds.has(id)) warnings.push(`${company.name || company.id} 引用的证据 ${id} 尚未提供。`);
    }
  }
  if (missing.length) warnings.push(`${missing.length} 家企业缺少必要数值，将列出缺口而不生成盈利数字。`);
  if (isDate(input.context?.eventDate) && isDate(input.context?.asOf) && input.context.eventDate > input.context.asOf) {
    warnings.push('事件尚未发生：经营结果仅为假设情景，不能视为已实现影响。');
  }
  if (isFiniteNumber(input.parameters?.lagMonths) && isFiniteNumber(input.parameters?.horizonMonths)
    && input.parameters.lagMonths >= input.parameters.horizonMonths) warnings.push('传导时滞不短于分析期限，期限内价格冲击为零；销量假设仍单独生效。');
  return { valid: errors.length === 0, errors, warnings, missing };
}

function operatingCompany(company, parameters, input) {
  const evidenceIds = Array.isArray(company.evidenceIds) ? [...company.evidenceIds] : [];
  const common = { id: company.id, name: company.name, role: company.role, shockChannel: company.shockChannel, parameters: { ...parameters }, evidenceIds };
  const missing = Object.keys(COMPANY_RANGES).filter(field => missingValue(company[field]));
  if (missing.length) return { ...common, status: 'missing', missing, limitations: missing.map(field => `需要补充${FIELD_LABELS[field]}及其期间与来源。`) };
  const revenue = company.baselineRevenue;
  const cogs = revenue * (1 - company.baselineGrossMarginPct / 100);
  const grossProfit = revenue - cogs;
  const volumeChange = parameters.volumePct / 100;
  const shock = parameters.shockPct / 100;
  const exposure = parameters.exposurePct / 100;
  const activeShare = Math.max(0, parameters.horizonMonths - parameters.lagMonths) / parameters.horizonMonths;
  const rawAffected = cogs * company.rawMaterialCostSharePct / 100 * exposure;
  const rawShockExpense = company.shockChannel === 'cost' ? rawAffected * shock * activeShare * (1 + volumeChange) : 0;
  const priceChange = company.shockChannel === 'cost'
    ? rawAffected / revenue * shock * activeShare * parameters.passThroughPct / 100
    : shock * activeShare * exposure;
  if (priceChange <= -1) return { ...common, status: 'missing', missing: ['positiveSellingPrice'], limitations: ['组合参数导致售价非正，需缩小负向冲击或成本转嫁假设。'] };
  const volumeRevenue = revenue * volumeChange;
  const pricingRevenue = revenue * (1 + volumeChange) * priceChange;
  const volumeCosts = cogs * company.variableCostSharePct / 100 * volumeChange;
  const scenarioRevenue = revenue + volumeRevenue + pricingRevenue;
  const scenarioCogs = cogs + volumeCosts + rawShockExpense;
  const scenarioGrossProfit = scenarioRevenue - scenarioCogs;
  const baseline = { revenue, cogs, grossProfit, grossMarginPct: company.baselineGrossMarginPct };
  const scenario = { revenue: scenarioRevenue, cogs: scenarioCogs, grossProfit: scenarioGrossProfit, grossMarginPct: scenarioGrossProfit / scenarioRevenue * 100, priceChangePct: priceChange * 100, rawShockExpense, activeShare };
  const delta = { revenue: scenarioRevenue - revenue, grossProfit: scenarioGrossProfit - grossProfit, grossMarginPp: scenario.grossMarginPct - baseline.grossMarginPct };
  if (!missingValue(company.fixedOperatingCost)) {
    baseline.operatingProfit = grossProfit - company.fixedOperatingCost;
    scenario.operatingProfit = scenarioGrossProfit - company.fixedOperatingCost;
    delta.operatingProfit = scenario.operatingProfit - baseline.operatingProfit;
    // Percentage growth is misleading when the baseline is zero or a loss.
    delta.operatingProfitPct = baseline.operatingProfit > 0 ? delta.operatingProfit / baseline.operatingProfit * 100 : null;
  }
  const limitations = [
    '这是给定参数下的经营情景估计，未包含产品组合、存货会计、汇率、税费、利息或资本开支变化。',
    '基线金额与销量、成本口径须属于同一期间；模型不自动年化或推断企业实际采购价。',
    '价格冲击在时滞后按分析期限均匀计入；未建模逐月采购、库存消化或动态销量反馈。',
  ];
  if (!evidenceIds.length) limitations.push('企业数值未绑定证据，所有结果应作为待验证假设。');
  const cited = (input.evidence || []).filter(item => evidenceIds.includes(item.id));
  if (cited.some(item => item.kind === 'assumption')) limitations.push('包含演示或研究假设；精确计算不等于真实预测。');
  if (cited.some(item => item.publishedAt && item.publishedAt > input.context.asOf)) limitations.push('引用包含截止日后发布资料，不具备当时可知的回测口径。');
  if (missingValue(company.fixedOperatingCost)) limitations.push('固定经营费用未提供，仅计算毛利，不计算经营利润或净利润。');
  if (company.shockChannel === 'selling_price') limitations.push('上游售价情景保持单位投入成本不受同一价格冲击影响；供需联动须另行补充。');
  return { ...common, status: 'estimated', baseline, scenario, delta,
    inputs: { ...company },
    bridge: [
      { id: 'volume_revenue', label: '销量带来的收入变化', value: volumeRevenue },
      { id: 'pricing_revenue', label: company.shockChannel === 'cost' ? '成本转嫁带来的收入变化' : '产品售价带来的收入变化', value: pricingRevenue },
      { id: 'volume_cost', label: '销量带来的变动成本变化', value: -volumeCosts },
      { id: 'raw_shock', label: '原料价格带来的成本变化', value: -rawShockExpense },
    ], limitations };
}

export function computeOperating(input) {
  const validation = validateInput(input);
  if (!validation.valid) {
    const error = new Error(validation.errors.join('\n'));
    error.issues = validation.errors;
    throw error;
  }
  const parameters = { ...input.parameters };
  const companies = input.companies.map(company => operatingCompany(company, parameters, input));
  const scenarios = [
    { id: 'pessimistic', label: '不利情景', direction: -1 },
    { id: 'base', label: '当前情景', direction: 0 },
    { id: 'optimistic', label: '有利情景', direction: 1 },
  ].map(({ id, label, direction }) => {
    const changed = { ...parameters,
      shockPct: clamp(parameters.shockPct - direction * 5, ...PARAMETER_RANGES.shockPct),
      passThroughPct: clamp(parameters.passThroughPct + direction * 20, 0, 100),
      volumePct: clamp(parameters.volumePct + direction * 5, ...PARAMETER_RANGES.volumePct),
    };
    return { id, label, parameters: changed, companies: input.companies.map(company => operatingCompany(company,
      { ...changed, shockPct: clamp(parameters.shockPct + (company.shockChannel === 'selling_price' ? direction : -direction) * 5, ...PARAMETER_RANGES.shockPct) }, input)),
      note: '各企业按成本或售价渠道分别调整冲击；三情景为参数压力测试，不表示发生概率。' };
  });
  const selected = companies.find(company => company.status === 'estimated');
  const first = input.companies.find(company => company.id === selected?.id);
  const sensitivity = first ? [
    ['shockPct', '价格冲击', 5], ['volumePct', '销量变化', 5],
    ['passThroughPct', '成本转嫁率', 20], ['exposurePct', '业务暴露', 20], ['lagMonths', '传导时滞', 3],
  ].filter(([key]) => first.shockChannel !== 'selling_price' || key !== 'passThroughPct').map(([key, label, step]) => {
    const low = clamp(parameters[key] - step, ...PARAMETER_RANGES[key]);
    const high = clamp(parameters[key] + step, ...PARAMETER_RANGES[key]);
    const lowResult = operatingCompany(first, { ...parameters, [key]: low }, input);
    const highResult = operatingCompany(first, { ...parameters, [key]: high }, input);
    return { key, label, companyId: first.id, low, high,
      lowDelta: lowResult.delta?.grossProfit ?? null, highDelta: highResult.delta?.grossProfit ?? null,
      unit: key === 'lagMonths' ? '月' : '%', target: 'grossProfit', targetUnit: '万元' };
  }) : [];
  const ranked = companies.filter(company => company.status === 'estimated').sort((a, b) => b.delta.grossProfit - a.delta.grossProfit);
  const best = ranked[0] ? { id: ranked[0].id, name: ranked[0].name, grossProfitDelta: ranked[0].delta.grossProfit } : null;
  const worst = ranked.at(-1) ? { id: ranked.at(-1).id, name: ranked.at(-1).name, grossProfitDelta: ranked.at(-1).delta.grossProfit } : null;
  const missingCount = companies.filter(company => company.status === 'missing').length;
  return { schemaVersion: '1.0', methodVersion: METHOD_VERSION, context: { ...input.context }, parameters, companies, scenarios, sensitivity,
    summary: { headline: ranked.length
      ? `给定假设下，${ranked.length} 家企业可计算毛利影响；${missingCount ? `${missingCount} 家仍需补数。` : '点击数字可查看来源与计算口径。'}`
      : '企业经营参数不足，当前不能给出精确毛利影响。', best, worst, missingCount },
    warnings: validation.warnings,
    methods: [
      { id: 'operating_bridge', label: '收入—成本—毛利桥接', version: METHOD_VERSION,
        formulas: ['基线营业成本 = 基线收入 × (1 − 基线毛利率)', '有效传导比例 = max(0, 分析期限 − 传导时滞) / 分析期限',
          '受影响原料成本 = 基线营业成本 × 原料成本比例 × 业务暴露比例',
          '成本渠道售价变化率 = 受影响原料成本 / 基线收入 × 价格冲击 × 有效传导比例 × 成本转嫁率',
          '售价渠道售价变化率 = 价格冲击 × 有效传导比例 × 业务暴露比例',
          '情景收入 = 基线收入 × (1 + 销量变化率) × (1 + 售价变化率)',
          '情景营业成本 = 基线营业成本 + 基线营业成本 × 变动成本比例 × 销量变化率 + 原料冲击成本',
          '原料冲击成本（成本渠道）= 受影响原料成本 × 价格冲击 × 有效传导比例 × (1 + 销量变化率)',
          '毛利 = 收入 − 营业成本；经营利润（有费用输入时）= 毛利 − 固定经营费用'],
        assumptions: ['原料成本属于变动成本的一部分；业务暴露仅作用于指定价格冲击。', '销量变化独立输入，固定营业成本与固定经营费用在情景中保持不变。', '三情景为人为设定压力测试，未估计概率与统计置信区间。'] },
    ], createdAt: new Date().toISOString() };
}

function normalizedPrices(rows, asOf, label, warnings) {
  const result = new Map();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    if (!row || !isDate(row.date) || !isFiniteNumber(row.close) || row.close <= 0
      || (!missingValue(row.adjFactor) && (!isFiniteNumber(row.adjFactor) || row.adjFactor <= 0))) {
      warnings.push(`${label} 存在无效日期或价格，已排除。`); continue;
    }
    if (row.date > asOf) continue;
    if (result.has(row.date)) warnings.push(`${label} 的 ${row.date} 重复，采用最后一条。`);
    result.set(row.date, { ...row, adjustedClose: row.close * (row.adjFactor ?? 1) });
  }
  return [...result.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function drawdown(prices) {
  if (prices.length < 2) return null;
  let peak = prices[0], worst = 0;
  for (const price of prices) { peak = Math.max(peak, price); worst = Math.min(worst, price / peak - 1); }
  return worst * 100;
}

export function runEventStudy({ eventDate, asOf, before = 5, after = 5, companies = [], benchmark = [], expectedReturnModel = 'market_adjusted' } = {}) {
  const warnings = [];
  const base = { method: expectedReturnModel === 'market_model' ? 'OLS 市场模型事件研究（等权样本）' : '市场调整事件研究（等权样本）', methodVersion: '1.2.0', expectedReturnModel, eventDate, asOf,
    window: { before, after }, series: [], companies: [], warnings,
    provenance: { returnUnit: '%', abnormalReturnUnit: '百分点', carRule: 'CAR = 选定事件窗口内每日 AR 的加总；非更早日期开始的累计差值。',
      returnRule: '相邻实际共同价格日期的调整后收盘价收益；累计收益按复利。',
      adjustmentRule: '股票 close × adjFactor；未提供因子时使用原始价格并提示。',
      interpretation: '市场反应不等于企业盈利变化，不作因果归因或显著性判断。' } };
  if (!isDate(eventDate) || !isDate(asOf) || !Number.isInteger(before) || !Number.isInteger(after)
    || before < 0 || after < 0 || before > 60 || after > 60 || !['market_adjusted', 'market_model'].includes(expectedReturnModel)) {
    return { ...base, status: 'unavailable', warnings: ['事件日期、截止日期或窗口无效；窗口须为 0 至 60 个交易日。'] };
  }
  if (eventDate > asOf) return { ...base, status: 'unavailable', warnings: ['事件晚于研究截止日，尚无已实现市场反应。'] };
  const bench = normalizedPrices(benchmark, asOf, '基准', warnings);
  const eventIndex = bench.findIndex(row => row.date >= eventDate);
  if (eventIndex < 0) return { ...base, status: 'unavailable', warnings: [...warnings, '截止日内没有事件当日或之后的基准交易记录；不回退到最后一条价格。'] };
  const tradingEventDate = bench[eventIndex].date;
  const start = Math.max(0, eventIndex - before), end = Math.min(bench.length - 1, eventIndex + after);
  const targetDates = new Set(bench.slice(start, end + 1).map(row => row.date));
  const benchByDate = new Map(bench.map(row => [row.date, row]));
  const benchIndex = new Map(bench.map((row, index) => [row.date, index]));
  let partial = start !== eventIndex - before || end !== eventIndex + after;
  if (partial) warnings.push('所需事件窗口未完全取得或超出截止日，仅展示真实可用的交易日期。');
  if (tradingEventDate !== eventDate) warnings.push(`事件日无基准交易，按首个后续交易日 ${tradingEventDate} 对齐。`);
  const companyResults = [], allReturns = [];
  for (const company of (Array.isArray(companies) ? companies : [])) {
    const rows = normalizedPrices(company?.prices, asOf, company?.name || company?.id || '股票', warnings);
    const common = rows.filter(row => benchByDate.has(row.date));
    const name = company?.name || company?.id || '未命名股票';
    if (rows.length && rows.some(row => missingValue(row.adjFactor))) warnings.push(`${name} 未完整提供复权因子，除权除息可能干扰事件收益。`);
    const returns = [];
    for (let index = 1; index < common.length; index++) {
      const row = common[index], previous = common[index - 1];
      const stockReturn = (row.adjustedClose / previous.adjustedClose - 1) * 100;
      const marketReturn = (benchByDate.get(row.date).adjustedClose / benchByDate.get(previous.date).adjustedClose - 1) * 100;
      returns.push({ date: row.date, previousDate: previous.date, day: benchIndex.get(row.date) - eventIndex,
        stock: stockReturn, benchmark: marketReturn, abnormal: stockReturn - marketReturn,
        span: benchIndex.get(row.date) - benchIndex.get(previous.date) });
    }
    // Only one-session returns belong to a daily event window: suspended/missing
    // sessions are not fabricated, and a resumed multi-day return is not relabelled daily.
    let estimation = null;
    if (expectedReturnModel === 'market_model') {
      const training = returns.filter(row => row.span === 1 && row.day < -before).slice(-120);
      const mx = training.length ? mean(training.map(r => r.benchmark)) : 0, my = training.length ? mean(training.map(r => r.stock)) : 0;
      const xx = training.reduce((sum, r) => sum + (r.benchmark - mx) ** 2, 0), xy = training.reduce((sum, r) => sum + (r.benchmark - mx) * (r.stock - my), 0);
      if (training.length >= 20 && xx > 1e-12) {
        const beta = xy / xx, alpha = my - beta * mx, yy = training.reduce((sum, r) => sum + (r.stock - my) ** 2, 0), residual = training.reduce((sum, r) => sum + (r.stock - alpha - beta * r.benchmark) ** 2, 0);
        estimation = { alpha, beta, rSquared: yy > 1e-12 ? Math.max(0, 1 - residual / yy) : null, sampleDays: training.length, startDate: training[0].date, endDate: training.at(-1).date };
        for (const r of returns) r.abnormal = r.stock - alpha - beta * r.benchmark;
      } else warnings.push(`${name} 的事件窗口前估计样本不足20个共同日收益或基准无波动；OLS 不可用，不偷偷回退为市场调整法。`);
    }
    const selected = returns.filter(row => targetDates.has(row.date) && row.span === 1 && (expectedReturnModel !== 'market_model' || estimation));
    const missingDates = [...targetDates].filter(date => !selected.some(row => row.date === date));
    if (missingDates.length) { partial = true; warnings.push(`${name} 在窗口中缺少 ${missingDates.length} 个同口径日收益，未以零填充；CAR 基于实际样本。`); }
    const pastVolumes = common.filter(row => row.date < tradingEventDate && isFiniteNumber(row.volume) && row.volume >= 0).slice(-60).map(row => row.volume);
    const eventVolumes = common.filter(row => targetDates.has(row.date) && row.date >= tradingEventDate && isFiniteNumber(row.volume) && row.volume >= 0).map(row => row.volume);
    let volumeZ = null;
    if (pastVolumes.length >= 20 && eventVolumes.length) {
      const average = mean(pastVolumes);
      const deviation = Math.sqrt(pastVolumes.reduce((sum, value) => sum + (value - average) ** 2, 0) / (pastVolumes.length - 1));
      if (deviation > 0) volumeZ = (mean(eventVolumes) - average) / deviation;
    }
    if (volumeZ === null) warnings.push(`${name} 成交量前置样本不足 20 日、无事件后数据或基线无波动，成交量 Z 值未计算。`);
    const selectedDates = new Set(selected.map(row => row.date));
    const firstReturn = selected[0];
    const pricesForDrawdown = common.filter(row => selectedDates.has(row.date) || row.date === firstReturn?.previousDate).map(row => row.adjustedClose);
    const hasEventReturn = selected.some(row => row.day >= 0);
    if (!hasEventReturn) warnings.push(`${name} 没有事件当日或之后的同口径收益，不能判断事件后市场反应。`);
    const result = { id: company?.id, name, role: company?.role,
      status: selected.length >= 3 && hasEventReturn ? (missingDates.length ? 'partial' : 'available') : 'insufficient',
      car: selected.length ? selected.reduce((sum, row) => sum + row.abnormal, 0) : null,
      volumeZ, maxDrawdown: drawdown(pricesForDrawdown), sampleDays: selected.length,
      expectedDays: targetDates.size, missingDates, estimation, daily: selected };
    companyResults.push(result);
    for (const row of selected) allReturns.push({ ...row, id: company?.id });
  }
  if (!companyResults.length) return { ...base, tradingEventDate, status: 'unavailable', warnings: [...warnings, '没有提供证券价格数据。'] };
  // Fixed-membership equal weighting: intersect available daily returns instead of
  // treating unavailable returns as zero or silently changing the sample each day.
  const byCompany = companyResults.filter(company => company.sampleDays > 0);
  const series = [];
  let car = 0, portfolioCumulative = 1, benchmarkCumulative = 1;
  for (const row of bench.slice(start, end + 1)) {
    const dateReturns = allReturns.filter(item => item.date === row.date);
    if (!byCompany.length || dateReturns.length !== byCompany.length) continue;
    const portfolio = mean(dateReturns.map(item => item.stock));
    const market = dateReturns[0].benchmark;
    const abnormal = mean(dateReturns.map(item => item.abnormal));
    car += abnormal;
    portfolioCumulative *= 1 + portfolio / 100;
    benchmarkCumulative *= 1 + market / 100;
    series.push({ date: row.date, day: benchIndex.get(row.date) - eventIndex,
      portfolio, benchmark: market, abnormal, car,
      portfolioCumulative: (portfolioCumulative - 1) * 100, benchmarkCumulative: (benchmarkCumulative - 1) * 100,
      n: byCompany.length });
  }
  if (series.length < targetDates.size) partial = true;
  if (byCompany.length < companyResults.length) warnings.push('无有效收益的证券已从组合排除，企业明细仍显示数据缺口。');
  const status = series.length < 3 || !series.some(row => row.day >= 0) ? 'insufficient' : partial ? 'partial' : 'available';
  if (status === 'insufficient') warnings.push('共同事件窗口收益少于 3 日，只能查看已有样本，不能据此概括完整事件反应。');
  return { ...base, status, tradingEventDate,
    window: { before, after, requestedDays: before + after + 1, actualDays: series.length,
      startDate: bench[start].date, endDate: bench[end].date,
      dates: bench.slice(start, end + 1).map(row => ({ date: row.date, day: benchIndex.get(row.date) - eventIndex })) }, series, companies: companyResults,
    provenance: { ...base.provenance, portfolioRule: '有数据证券固定样本等权；组合仅使用各证券均有实际同一交易日收益的日期。',
      includedCompanyIds: byCompany.map(company => company.id), volumeRule: '事件日及之后窗口均量相对事件日前最多60日均量的样本标准分，至少20日前置观测。' } };
}
