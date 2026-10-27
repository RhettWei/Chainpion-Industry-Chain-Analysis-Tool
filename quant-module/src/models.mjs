import { computeOperating, validateInput, runEventStudy } from './core.mjs';
import { entityErrors, computeEntities } from './scenarios.mjs';
import { signedValue } from './display.mjs';

export const BASELINE_FIELDS = {
  baselineRevenue: { label: '基线营业收入', unit: '万元', note: '同一业务范围、同一基线期间的营业收入，不是营业总收入。' },
  baselineGrossMarginPct: { label: '基线毛利率', unit: '%', note: '(营业收入 − 营业成本) / 营业收入。不得用净利率替代。' },
  rawMaterialCostSharePct: { label: '指定成本项占营业成本', unit: '%', note: '只计本次受冲击的采购／能源／加工等变动成本项；分母为营业成本，不是收入。不得把单个产品降本施加于全部成本。' },
  variableCostSharePct: { label: '变动成本占营业成本', unit: '%', note: '随销量成比例变化的成本；财报未直接披露时须明确估计依据。' },
  fixedOperatingCost: { label: '固定经营费用', unit: '万元', note: '模型中的固定销售／管理／研发等经营费用，不含已计入营业成本的固定成本；不是财报营业利润倒推值。' },
};
const common = ['baselineRevenue', 'baselineGrossMarginPct', 'variableCostSharePct'];
export const MODEL_CATALOG = [
  { id: 'cost_transmission', title: '成本传导', topic: '原材料／能源涨跌、采购成本冲击与成本转嫁', icon: '↗',
    shortDescription: '比较采购成本、售价转嫁和时滞对企业毛利的情景影响。',
    question: '采购成本变化有多少被售价转嫁？谁的毛利承压？', required: [...common, 'rawMaterialCostSharePct'],
    params: ['shockPct', 'volumePct', 'passThroughPct', 'exposurePct', 'lagMonths', 'horizonMonths'],
    outputs: '毛利桥接、三情景、单参数敏感性、企业影响比较',
    formulas: ['C₀ = R₀ × (1 − g₀)；A = C₀ × a × e；h = max(0, H − L) / H', '成本渠道：p = (A / R₀) × s × h × τ；ΔC原料 = A × s × h × (1 + q)', '售价渠道：p = s × h × e；ΔC原料 = 0', 'R₁ = R₀ × (1 + q) × (1 + p)', 'C₁ = C₀ + C₀ × b × q + ΔC原料', 'GP₁ = R₁ − C₁；ΔGP = GP₁ − (R₀ − C₀)；OP = GP − F（已提供 F 时）'],
    assumptions: ['R₀ 收入，g₀ 毛利率，a 原料成本占比，b 变动成本占比，e 暴露比例；s 冲击，τ 转嫁率，q 销量变化，H 期限，L 时滞，F 固定经营费用。公式中的百分数须除以 100。', 'a ≤ b；价格冲击按有效月份加权，销量独立输入；不自动按月份缩放基线金额。', '售价渠道与成本渠道每家企业择一；不自动验证供应商—客户关系，不把上游冲击再次传给下游。', '不含库存、税费、融资、产能约束；压力测试不是统计置信区间。'] },
  { id: 'volume_price', title: '量价—利润', topic: '订单／销量增减、产品提价降价与需求变化', icon: '⇄',
    shortDescription: '用已确认的收入与成本基线，分别调整销量和产品售价。',
    question: '销量和售价同时变动，收入及毛利怎样变化？', required: common,
    params: ['shockPct', 'volumePct'], outputs: '收入—成本—毛利桥接、量价交互、情景与敏感性',
    formulas: ['C₀ = R₀ × (1 − g₀)；V₀ = C₀ × b；K₀ = C₀ × (1 − b)', 'R₁ = R₀ × (1 + q) × (1 + p)', 'C₁ = V₀ × (1 + q) + K₀', 'GP₁ = R₁ − C₁；ΔGP = R₀q + R₀(1 + q)p − V₀q', 'OP₁ = GP₁ − F（已提供 F 时）'],
    assumptions: ['p 为该对象明确产品的平均售价变化率，q 为同范围销量变化；不用成本转嫁率、暴露和时滞。', '单位变动成本、额外固定经营费用可以独立设定变化；默认不变。售价不会自动改变销量，未估计需求弹性。', '同对象产品组合不变；单产品或分部须使用同范围基线。百分数在公式中除以 100。'] },
  { id: 'break_even', title: '本量利／盈亏平衡', topic: '扩产经营门槛、价格竞争与盈亏安全边际', icon: '◎',
    shortDescription: '计算覆盖固定经营成本所需的收入和销量门槛。',
    question: '至少需要多少收入或销量才能不亏？当前安全边际多大？', required: [...common, 'fixedOperatingCost'],
    params: ['shockPct', 'volumePct'], outputs: '盈亏平衡曲线、门槛收入、销量门槛、安全边际、经营情景',
    formulas: ['V₀ = R₀ × (1 − g₀) × b；K = R₀ × (1 − g₀) × (1 − b) + F', 'D = R₀ × (1 + p) − V₀（基线销量水平的贡献毛益）', '贡献毛益率 m = D / [R₀ × (1 + p)]', '盈亏平衡收入 R* = K / m；盈亏平衡销量指数 Q* / Q₀ = K / D', '情景经营利润 OP₁ = D × (1 + q) − K', '安全边际率 = (R₁ − R*) / R₁；达到盈亏平衡所需销量变化 = K / D − 1'],
    assumptions: ['只有 D > 0 才存在有限正向盈亏平衡点；D ≤ 0 时明确不计算门槛，不展示伪造的零值。', '没有实际销量单位时使用基线销量指数 Q₀ = 1，不能标作吨／台／件。', 'K 同时包含营业成本中的固定部分和额外固定经营费用 F，须避免重复计入。', '线性本量利近似，产品组合、单位变动成本、产能与固定费用保持不变；不是净利润盈亏平衡。'] },
  { id: 'event_study', title: '市场事件研究', topic: '已发生政策／公告／重大事件的证券市场反应', icon: '⌁', required: [], params: [],
    shortDescription: '使用证券与基准行情描述事件窗口内的相对市场反应。',
    question: '事件窗口内相对市场基准的反应是什么？', outputs: 'AR／CAR、累计收益、成交量 Z、最大回撤',
    formulas: ['调整后价格 Pₜ = closeₜ × adjFactorₜ；rₜ = Pₜ / Pₜ₋₁ − 1', 'ARᵢₜ = rᵢₜ − r基准ₜ；CARᵢ = Σ窗口 ARᵢₜ', '组合以固定有效样本等权，累计收益 = ∏窗口(1 + rₜ) − 1', '成交量 Z = (事件日及之后窗口均量 − 事件前均量) / 事件前样本标准差', '最大回撤 = minₜ(Pₜ / 历史峰值ₜ − 1)'],
    assumptions: ['需要事件日、截止日、证券及基准的同口径行情；不需要企业收入和成本结构。', '窗口按交易日；CAR 包含所选事件前窗口，不等于两条复利收益之差。', '成交量前置样本至少 20 日、最多 60 日；无复权因子时提示降级。', '描述市场反应，不识别因果、不作显著性检验，也不能代替一级市场经营测算。'] },
];
// The structured entity variant supports separate shocks instead of one global rate.
const definitions = {
  cost_transmission: ['C₀ = R₀(1−g₀)；V₀ = C₀b；K₀ = C₀−V₀；A = C₀a', 'h = max(0,H−L)/H；Δc = A×s×h；p = p直接 + (Δc/R₀)×τ', 'R₁ = R₀(1+q)(1+p)；C₁ = (V₀+Δc)(1+q)+K₀', 'GP₁ = R₁−C₁；F₁ = F₀(1+f)；OP₁ = GP₁−F₁'],
  volume_price: ['C₀ = R₀(1−g₀)；V₀ = C₀b；K₀ = C₀−V₀', 'R₁ = R₀(1+q)(1+p)；C₁ = V₀(1+s)(1+q)+K₀', 'GP₁ = R₁−C₁；ΔGP = R₀q + R₀(1+q)p − V₀q − V₀s(1+q)', 'F₁ = F₀(1+f)；OP₁ = GP₁−F₁（有 F₀ 时）'],
  break_even: ['V₁ = R₀(1−g₀)b(1+s)；K = R₀(1−g₀)(1−b)+F₀(1+f)', 'D = R₀(1+p)−V₁；m = D/[R₀(1+p)]', 'D > 0 时：R* = K/m；Q*/Q₀ = K/D；OP₁ = D(1+q)−K', '安全边际 = (R₁−R*)/R₁；D ≤ 0 不存在有限正向门槛'],
};
for (const model of MODEL_CATALOG) if (definitions[model.id]) {
  model.legacyFormulas = model.formulas;
  model.legacyAssumptions = [...model.assumptions];
  model.formulas = definitions[model.id];
  if (model.id === 'cost_transmission') model.assumptions = model.assumptions.filter(text => !text.includes('售价渠道与成本渠道'));
  if (model.id === 'break_even') model.assumptions = model.assumptions.map(text => text.includes('线性本量利近似') ? '线性本量利近似，产品组合、单位成本及固定费用在每个给定情景内保持恒定；不同情景可明确调整。无产能上限测算，不是净利润盈亏平衡。' : text);
  model.assumptions.push('逐对象独立参数：p直接 是明确产品平均售价变化，q 销量，s 指定成本项／单位变动成本变化，f 额外固定经营费用变化；成本模型另用 a 成本占比、τ 转嫁或让利、H 期限、L 时滞。', '未受事件影响的对象全部变化为零；成本下降只有设定让利比例才影响售价。毛利不含固定经营费用，经营利润不等于净利润。');
}
MODEL_CATALOG[3].formulas.push('可选OLS：在事件前、且不含事件窗口的最多120日拟合 rᵢ=αᵢ+βᵢrₘ+ε；ARᵢₜ=rᵢₜ−(αᵢ+βᵢrₘₜ)', '估计至少20个共同日收益且基准方差非零；不足时明确不可用，不自动回退。');
MODEL_CATALOG[3].assumptions = MODEL_CATALOG[3].assumptions.map(text=>text.includes('不识别因果')?'市场调整法假设α=0、β=1；OLS使用事件前独立估计窗口。两者都描述市场反应，不识别因果、不作显著性检验，也不能代替经营测算。':text);
export function modelFor(input) { return MODEL_CATALOG.find(model => model.id === input?.analysis?.model) || MODEL_CATALOG[0]; }

const sourceRoutes = ['assumption', 'materials', 'online'];
function isIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/);
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59
    || Number(match[6] || 0) > 23 || Number(match[7] || 0) > 59 || !Number.isFinite(Date.parse(value))) return false;
  const day = new Date(`${match[1]}T00:00:00Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === match[1];
}
function sourceErrors(source, { input, field, label, requireLegacyEvidence = false, confirmedAt } = {}) {
  const errors = [];
  if (!source || typeof source !== 'object' || Array.isArray(source) || !['user', 'reference', 'assumption'].includes(source.kind)) {
    return [`${label} 的字段来源格式无效。`];
  }
  const routed = source.route !== undefined;
  if (routed && !sourceRoutes.includes(source.route)) errors.push(`${label} 的数据获取路线无效。`);
  if (source.route === 'assumption' && source.kind !== 'assumption') errors.push(`${label} 的假设路线必须标为情景假设。`);
  const referenceRoute = ['materials', 'online'].includes(source.route);
  if (referenceRoute && source.kind !== 'reference') errors.push(`${label} 的资料／在线路线必须标为参考资料。`);
  if (referenceRoute || (source.kind === 'reference' && requireLegacyEvidence)) {
    const evidence = (Array.isArray(input.evidence) ? input.evidence : []).find(item => item.id === source.evidenceId);
    if (!evidence) errors.push(`${label} 的 ${BASELINE_FIELDS[field]?.label || field}参考值缺少有效来源。`);
    else if (referenceRoute && (evidence.kind === 'assumption' || typeof evidence.source !== 'string' || !evidence.source.trim())) {
      errors.push(`${label} 的资料参考必须绑定非假设且有发布机构／文件名的证据。`);
    }
  }
  if (referenceRoute && !source.review) errors.push(`${label} 的资料参考尚未核对通过，不能确认基准。`);
  if (source.review !== undefined) {
    const review = source.review;
    if (!review || typeof review !== 'object' || Array.isArray(review) || review.status !== 'approved'
      || !isIsoTimestamp(review.reviewedAt) || typeof review.period !== 'string' || !review.period.trim()
      || review.period !== input.context?.periodLabel) {
      errors.push(`${label} 的资料核对记录无效或期间已变更，请重新核对。`);
    } else if (confirmedAt && Date.parse(review.reviewedAt) > Date.parse(confirmedAt)) {
      errors.push(`${label} 的资料核对时间晚于基准确认时间，请重新确认。`);
    }
  }
  return errors;
}
function sameSource(left, right) {
  return left.kind === right.kind && left.evidenceId === right.evidenceId && left.route === right.route
    && left.review?.status === right.review?.status && left.review?.reviewedAt === right.review?.reviewedAt
    && left.review?.period === right.review?.period;
}

// Adapt old 1.0 inputs without changing their formulas or inventing missing financial data.
function operatingInput(input) {
  const model = modelFor(input);
  if (model.id === 'event_study') {
    // The empty-company core call only builds a result envelope; these values
    // are internal and never used as market observations or financial inputs.
    return { ...input, context: { ...input.context, periodLabel: '行情窗口（无需企业财务基线）' },
      parameters: { shockPct: 0, volumePct: 0, passThroughPct: 0, exposurePct: 100, lagMonths: 0, horizonMonths: 12 }, companies: [] };
  }
  if (model.id === 'cost_transmission') return input;
  return { ...input, parameters: { ...input.parameters, passThroughPct: 0, exposurePct: 100, lagMonths: 0 },
    companies: Array.isArray(input.companies) ? input.companies.map(company => company && typeof company === 'object' ? { ...company, shockChannel: 'selling_price', rawMaterialCostSharePct: 0 } : company) : input.companies };
}
export function validateQuant(input) {
  if (input?.analysis?.model && !MODEL_CATALOG.some(model => model.id === input.analysis.model)) return { valid: false, errors: ['所选量化模型不存在。'], warnings: [], missing: [] };
  const model = modelFor(input);
  const adapted = operatingInput(input);
  const activeFields = new Set(model.id === 'event_study' ? [] : [...model.required, 'fixedOperatingCost']);
  const validation = validateInput(adapted);
  if (input?.analysis?.scenarioMode !== undefined && input.analysis.scenarioMode !== 'entity') validation.errors.push('scenarioMode 无效；逐对象情景请使用 entity。');
  if (input?.analysis?.marketMethod && !['market_adjusted', 'market_model'].includes(input.analysis.marketMethod)) validation.errors.push('市场预期收益方法无效。');
  for (const company of Array.isArray(input?.companies) ? input.companies : []) {
    if (!company || typeof company !== 'object') continue;
    if (company.baselineSources !== undefined && (!company.baselineSources || typeof company.baselineSources !== 'object' || Array.isArray(company.baselineSources))) {
      validation.errors.push(`${company.name || company.id} 的字段来源必须为对象。`); continue;
    }
    for (const [field, source] of Object.entries(company.baselineSources || {})) {
      if (!BASELINE_FIELDS[field]) validation.errors.push(`${company.name || company.id} 的字段来源格式无效。`);
      else if (activeFields.has(field)) validation.errors.push(...sourceErrors(source, { input, field, label: company.name || company.id, requireLegacyEvidence: true }));
    }
  }
  const review = input?.analysis?.baselineReview;
  if (review) {
    if ((model.id !== 'event_study' && review.periodLabel !== input.context?.periodLabel)
      || !Array.isArray(review.fields) || !isIsoTimestamp(review.confirmedAt)) validation.errors.push('基准确认记录无效或期间已变更，请重新确认。');
    else {
      for (const company of Array.isArray(input.companies) ? input.companies : []) {
        for (const field of model.required) {
          const recorded = review.fields.find(row => row?.companyId === company.id && row.field === field);
          if (!recorded || !Number.isFinite(recorded.value) || recorded.value !== company[field]) validation.errors.push(`${company.name} 的 ${BASELINE_FIELDS[field].label}与已确认基准不一致，请重新确认。`);
        }
      }
      for (const recorded of review.fields) {
        if (!recorded || typeof recorded !== 'object' || !BASELINE_FIELDS[recorded.field]) {
          validation.errors.push('基准确认字段格式无效，请重新确认。'); continue;
        }
        if (!activeFields.has(recorded.field)) continue;
        if (!Number.isFinite(recorded.value)) { validation.errors.push('基准确认字段格式无效，请重新确认。'); continue; }
        const company = input.companies?.find(row => row.id === recorded.companyId);
        if (company && company[recorded.field] !== recorded.value) validation.errors.push('基准数值已变更，请重新确认。');
        if (!company) { validation.errors.push('基准确认记录引用的企业不存在，请重新确认。'); continue; }
        validation.errors.push(...sourceErrors(recorded, { input, field: recorded.field, label: company.name || company.id, confirmedAt: review.confirmedAt }));
        const source = company.baselineSources?.[recorded.field];
        if ((recorded.route !== undefined || source?.route !== undefined) && (!source || !sameSource(source, recorded))) {
          validation.errors.push(`${company.name} 的 ${BASELINE_FIELDS[recorded.field].label}来源或核对记录已变更，请重新确认。`);
        }
      }
    }
  }
  if (model.id === 'event_study') validation.warnings = validation.warnings.filter(message => !message.includes('尚未选定企业'));
  if (model.id === 'break_even') for (const company of input.companies || []) {
    if (company.fixedOperatingCost == null || company.fixedOperatingCost === '') {
      const row = validation.missing.find(item => item.id === company.id);
      if (row) row.fields.push('fixedOperatingCost');
      else validation.missing.push({ id: company.id, name: company.name, fields: ['fixedOperatingCost'] });
    }
  }
  validation.valid = validation.errors.length === 0;
  validation.errors.push(...entityErrors(input, model));
  validation.valid = validation.errors.length === 0;
  return validation;
}
export function computeQuant(input, { marketData, before = 5, after = 5 } = {}) {
  const validation = validateQuant(input), model = modelFor(input);
  if (!validation.valid) throw new Error(validation.errors.join('\n'));
  if (input.analysis?.scenarioMode === 'entity' && model.id !== 'event_study') return computeEntities(input, model, validation);
  const result = computeOperating(operatingInput(input));
  result.modelId = model.id; result.modelTitle = model.title; result.methodVersion = '1.1.0';
  result.parameters = { ...input.parameters };
  result.methods = [{ id: model.id, label: model.title, version: model.id === 'event_study' ? '1.2.0' : '1.1.0', formulas: model.legacyFormulas || model.formulas, assumptions: model.legacyAssumptions || model.assumptions }];
  result.warnings = validation.warnings;
  result.baselineReview = input.analysis?.baselineReview || null;
  if (model.id === 'event_study') {
    result.methodVersion = '1.2.0';
    result.context = { ...input.context };
    result.scenarios = [];
    // Market results must not leak operating scenarios, parameters or evidence.
    result.companies = [];
    result.sensitivity = [];
    result.parameters = {};
    if (result.baselineReview) result.baselineReview = { ...result.baselineReview, fields: [] };
    result.marketStudy = runEventStudy({ ...marketData, eventDate: input.context.eventDate, asOf: input.context.asOf, before, after, expectedReturnModel: input.analysis?.marketMethod || 'market_adjusted' });
    result.summary = { headline: result.marketStudy.series.length ? `市场事件研究：${result.marketStudy.series.length} 个共同有效交易日；窗口末 CAR ${signedValue(result.marketStudy.series.at(-1).car, 2)} 个百分点。` : '尚无足够行情，请补充证券与市场基准数据。', best: null, worst: null, missingCount: 0 };
    return result;
  }
  if (model.id !== 'cost_transmission') {
    result.sensitivity = result.sensitivity.filter(row => ['shockPct', 'volumePct'].includes(row.key)).map(row => ({ ...row, label: row.key === 'shockPct' ? '产品售价变化' : row.label }));
    const describe = row => {
      row.parameters = { shockPct: row.parameters.shockPct, volumePct: row.parameters.volumePct };
      row.limitations = [...model.assumptions, ...row.limitations.filter(text => !text.includes('价格冲击在时滞') && !text.includes('上游售价情景'))];
      return row;
    };
    result.companies = result.companies.map(describe);
    result.scenarios.forEach(row => {
      row.companies = row.companies.map(describe);
      row.parameters = row.companies[0]?.parameters || { shockPct: input.parameters.shockPct, volumePct: row.parameters.volumePct };
      row.note = '售价变化与销量变化分别 ±5 个百分点，其他条件不变；参数压力测试，无概率含义。';
    });
  }
  if (model.id === 'break_even') {
    const extend = row => {
      const missing = validation.missing.find(item => item.id === row.id);
      if (missing) return { id: row.id, name: row.name, role: row.role, status: 'missing', missing: missing.fields, limitations: missing.fields.map(field => `需要补充${BASELINE_FIELDS[field]?.label || field}。`) };
      if (row.status !== 'estimated') return row;
      const company = input.companies.find(item => item.id === row.id), p = row.scenario.priceChangePct / 100;
      const variableCost = row.baseline.cogs * company.variableCostSharePct / 100;
      const fixedCost = row.baseline.cogs - variableCost + company.fixedOperatingCost;
      const contribution = row.baseline.revenue * (1 + p) - variableCost;
      const margin = contribution / (row.baseline.revenue * (1 + p));
      row.breakEven = { status: contribution > 0 ? 'available' : 'no_positive_contribution', fixedCost, variableCost, contributionMarginPct: margin * 100,
        revenue: contribution > 0 ? fixedCost / margin : null, volumeIndex: contribution > 0 ? fixedCost / contribution : null,
        requiredVolumeChangePct: contribution > 0 ? (fixedCost / contribution - 1) * 100 : null,
        safetyMarginPct: contribution > 0 ? (row.scenario.revenue - fixedCost / margin) / row.scenario.revenue * 100 : null };
      if (contribution <= 0) row.limitations.push('贡献毛益非正，不存在有限的正向盈亏平衡点。');
      return row;
    };
    result.companies = result.companies.map(extend);
    result.scenarios.forEach(row => { row.companies = row.companies.map(extend); });
    const ranked = result.companies.filter(row => row.status === 'estimated').sort((a, b) => b.delta.grossProfit - a.delta.grossProfit);
    result.summary.best = ranked[0] ? { id: ranked[0].id, name: ranked[0].name, grossProfitDelta: ranked[0].delta.grossProfit } : null;
    result.summary.worst = ranked.at(-1) ? { id: ranked.at(-1).id, name: ranked.at(-1).name, grossProfitDelta: ranked.at(-1).delta.grossProfit } : null;
    result.summary.missingCount = result.companies.length - ranked.length;
    const firstValid = result.companies.find(row => row.status === 'estimated');
    if (!firstValid) result.sensitivity = [];
    else if (result.sensitivity[0]?.companyId !== firstValid.id) {
      const adapted = operatingInput(input);
      result.sensitivity = computeOperating({ ...adapted, companies: adapted.companies.filter(row => row.id === firstValid.id) }).sensitivity
        .filter(row => ['shockPct', 'volumePct'].includes(row.key)).map(row => ({ ...row, label: row.key === 'shockPct' ? '产品售价变化' : row.label }));
    }
  }
  return result;
}
