// Structured scenarios are opt-in; old integrations retain their 1.0 calculations.
export const ENTITY_PARAMS = {
  pricePct: { label: '产品平均售价变化', min: -90, max: 200, step: 1, unit: '%' },
  volumePct: { label: '该业务销量变化', min: -90, max: 100, step: 1, unit: '%' },
  costPct: { label: '指定成本项单价变化', min: -90, max: 200, step: 1, unit: '%' },
  passThroughPct: { label: '成本变化转嫁／让利比例', min: 0, max: 100, step: 1, unit: '%' },
  lagMonths: { label: '生效时滞', min: 0, max: 36, step: 1, unit: '月' },
  fixedExpensePct: { label: '额外固定经营费用变化', min: -100, max: 200, step: 1, unit: '%' },
};
export const neutralScenario = () => ({ affected: false, pricePct: 0, volumePct: 0, costPct: 0, passThroughPct: 0, lagMonths: 0, fixedExpensePct: 0 });
export function entityParams(modelId) { return modelId === 'cost_transmission' ? Object.keys(ENTITY_PARAMS) : ['pricePct', 'volumePct', 'costPct', 'fixedExpensePct']; }
export function parseEvent(description = '') {
  // ponytail: a conservative rule-based draft, not entity recognition or factual verification.
  // Multiple percentages/metrics require explicit human decomposition rather than guessing.
  const text = String(description);
  const matches = [...text.matchAll(/(售价|销售价格|价格|采购成本|单位成本|成本|销量|订单量|固定经营费用|固定费用)\s*(下降|降低|减少|下跌|提高|上涨|增加|增长|上升|降|涨)\s*([+-]?\d+(?:\.\d+)?)\s*[%％]/g)];
  if (matches.length !== 1 || [...text.matchAll(/[+-]?\d+(?:\.\d+)?\s*[%％]/g)].length !== 1) return { status: 'manual', reason: '未识别到唯一明确的“指标＋方向＋百分比”。请手动分解对象和参数，不会沿用默认 +10%。' };
  const [, metric, direction, amount] = matches[0];
  if (Number(amount) < 0) return { status: 'manual', reason: '文字方向与带负号数值可能冲突，请手动确认。' };
  const key = /成本/.test(metric) ? 'costPct' : /费用/.test(metric) ? 'fixedExpensePct' : /销量|订单/.test(metric) ? 'volumePct' : /售价|销售价格/.test(metric) ? 'pricePct' : null;
  if (!key) return { status: 'manual', reason: '“价格”未说明是采购成本还是产品售价，请明确后再设置。' };
  const value = Number(amount) * (/下降|降低|减少|下跌|降/.test(direction) ? -1 : 1);
  const spec = ENTITY_PARAMS[key];
  if (value < spec.min || value > spec.max) return { status: 'manual', reason: `幅度超出本模型 ${spec.min}～${spec.max}% 的边界，请手动检查。` };
  return { status: 'candidate', key, value, metric, reason: key === 'costPct' ? '仅提取降本幅度，不是已核实事实。必须核对它是具体成本项的单位成本还是总成本；本模型采用单位成本变化，不把总成本或项目预算下降自动等同于单价下降。请选择企业、业务范围和成本项后采用。' : '仅从文字提取研究假设；不代表已发生或已核实。请选择具体企业与产品后采用。' };
}
export function upgradeEntities(input, { demo = false } = {}) {
  input.analysis ||= {};
  if (input.analysis.scenarioMode === 'entity') return input;
  input.analysis.scenarioMode = 'entity';
  for (const company of input.companies) {
    company.scope = { level: 'company', product: demo ? ({ upstream: '资源产品组合（虚构）', midstream: '电池材料组合（虚构）', downstream: '整车组合（虚构）' }[company.role] || '企业产品组合（虚构）') : '', costItem: demo ? '受冲击原料（虚构）' : '', unit: '综合均价指数' };
    company.scenario = neutralScenario();
    if (demo) company.scenario = { ...company.scenario, affected: true, [company.shockChannel === 'cost' ? 'costPct' : 'pricePct']: input.parameters.shockPct, volumePct: input.parameters.volumePct, passThroughPct: company.shockChannel === 'cost' ? input.parameters.passThroughPct : 0, lagMonths: input.parameters.lagMonths };
  }
  return input;
}
export function entityErrors(input, model) {
  if (input?.analysis?.scenarioMode !== 'entity') return [];
  const errors = [];
  if (model.id === 'event_study') return errors;
  if (!input.context?.eventDescription?.trim?.()) errors.push('请明确研究事件，再定义对象与参数。');
  for (const company of Array.isArray(input.companies) ? input.companies : []) {
    if (!company || typeof company !== 'object') continue;
    const scope = company.scope, scenario = company.scenario;
    if (!scope || !['company', 'segment', 'product'].includes(scope.level) || typeof scope.product !== 'string' || !scope.product.trim() || scope.product.length > 300) errors.push(`${company.name}：请明确测算范围和销售产品／业务名称。`);
    if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario) || typeof scenario.affected !== 'boolean') { errors.push(`${company.name}：请明确是否受到本事件影响。`); continue; }
    for (const [key, spec] of Object.entries(ENTITY_PARAMS)) if (!Number.isFinite(scenario[key]) || scenario[key] < spec.min || scenario[key] > spec.max || (key === 'lagMonths' && !Number.isInteger(scenario[key]))) errors.push(`${company.name}：${spec.label}须为 ${spec.min}～${spec.max}${spec.unit} 的有效数值。`);
    if (scenario.affected && scenario.costPct !== 0 && (typeof scope?.costItem !== 'string' || !scope.costItem.trim() || scope.costItem.length > 300)) errors.push(`${company.name}：成本变化必须明确具体成本项目。`);
    if (!scenario.affected && Object.keys(ENTITY_PARAMS).some(key => scenario[key] !== 0)) errors.push(`${company.name}：未受影响对象的变化参数必须归零，避免隐藏冲击。`);
    if (model.id !== 'cost_transmission' && (scenario.passThroughPct !== 0 || scenario.lagMonths !== 0)) errors.push(`${company.name}：量价／本量利模型不使用成本转嫁或时滞，请设为零。`);
    if (scenario.fixedExpensePct !== 0 && company.fixedOperatingCost == null) errors.push(`${company.name}：固定经营费用变化需要该费用基线。`);
    if (scope?.unit != null && (typeof scope.unit !== 'string' || scope.unit.length > 100)) errors.push(`${company.name}：计价单位格式无效。`);
  }
  const mapping = input.analysis?.eventMapping;
  if (mapping && (mapping.description !== input.context?.eventDescription || mapping.eventDate !== input.context?.eventDate || mapping.modelId !== model.id)) errors.push('研究事件或模型已改变，请重新审核事件与参数的对应关系。');
  const snapshot = input.analysis?.baselineReview?.scopes;
  if (snapshot && JSON.stringify(snapshot) !== JSON.stringify(input.companies.map(c => ({ id: c.id, scope: c.scope })))) errors.push('产品或测算范围已变化，请重新确认基准。');
  return errors;
}

function companyResult(company, input, model, scenario = company.scenario) {
  const params = { ...scenario };
  const common = { id: company.id, name: company.name, role: company.role, scope: { ...company.scope }, affected: scenario.affected, shockChannel: model.id === 'cost_transmission' ? 'cost' : 'selling_price', parameters: params, evidenceIds: company.evidenceIds || [], inputs: company };
  const missing = model.required.filter(key => company[key] == null || company[key] === '');
  if (missing.length) return { ...common, status: 'missing', missing, limitations: ['缺少同范围基准，不以零替代。'] };
  const R = company.baselineRevenue, C = R * (1 - company.baselineGrossMarginPct / 100), V = C * company.variableCostSharePct / 100, K = C - V;
  const h = model.id === 'cost_transmission' ? Math.max(0, input.parameters.horizonMonths - scenario.lagMonths) / input.parameters.horizonMonths : 1;
  const A = model.id === 'cost_transmission' ? C * company.rawMaterialCostSharePct / 100 : V;
  const q = scenario.volumePct / 100, s = scenario.costPct / 100;
  const costUnitDelta = A * s * h;
  const passPrice = model.id === 'cost_transmission' ? costUnitDelta / R * scenario.passThroughPct / 100 : 0;
  const p = scenario.pricePct / 100 + passPrice;
  if (p <= -1) return { ...common, status: 'missing', missing: ['positiveSellingPrice'], limitations: ['直接售价变化与让利合计导致售价非正，请缩小参数。'] };
  const revenue = R * (1 + q) * (1 + p), rawShockExpense = costUnitDelta * (1 + q), cogs = V * (1 + q) + K + rawShockExpense;
  const grossProfit = revenue - cogs;
  const baseline = { revenue: R, cogs: C, grossProfit: R - C, grossMarginPct: company.baselineGrossMarginPct };
  const next = { revenue, cogs, grossProfit, grossMarginPct: grossProfit / revenue * 100, priceChangePct: p * 100, rawShockExpense, activeShare: h, variableCostAtBaselineVolume: V + costUnitDelta, fixedManufacturingCost: K };
  const delta = { revenue: revenue - R, grossProfit: grossProfit - baseline.grossProfit, grossMarginPp: next.grossMarginPct - baseline.grossMarginPct };
  const F = company.fixedOperatingCost;
  if (F != null) {
    baseline.operatingProfit = baseline.grossProfit - F;
    next.fixedOperatingCost = F * (1 + scenario.fixedExpensePct / 100);
    next.operatingProfit = grossProfit - next.fixedOperatingCost;
    delta.operatingProfit = next.operatingProfit - baseline.operatingProfit;
    delta.operatingProfitPct = baseline.operatingProfit > 0 ? delta.operatingProfit / baseline.operatingProfit * 100 : null;
  }
  const row = { ...common, status: 'estimated', baseline, scenario: next, delta,
    bridge: [ { id: 'volume_revenue', label: '销量收入贡献', value: R * q }, { id: 'pricing_revenue', label: '直接提价／调价贡献', value: R * (1 + q) * scenario.pricePct / 100 }, { id: 'pass_revenue', label: '成本转嫁／降本让利', value: R * (1 + q) * passPrice }, { id: 'volume_cost', label: '销量变动成本贡献', value: -V * q }, { id: 'raw_shock', label: `${company.scope.costItem || '单位变动成本'}变化贡献`, value: -rawShockExpense } ],
    limitations: [...model.assumptions, !scenario.affected ? '该对象设为未受事件影响，保持原有基线；不是统计对照组。' : '参数只作用于本对象的明确业务范围；产业位置不会自动决定冲击。', '不同对象独立计算；未建立采购关系或系数时，不自动传播供应商降本，也不把竞争影响当作事实。', '基准收入、毛利率及成本均须属于同一产品范围；没有分部数据时不能用整家公司数据冒充单产品基线。', '单位与销量为说明性字段；本模型使用相对均价／销量指数，未推断真实单价或数量。'] };
  if (model.id === 'break_even') {
    const variable = V + costUnitDelta, fixed = K + next.fixedOperatingCost, D = R * (1 + p) - variable, margin = D / (R * (1 + p));
    row.breakEven = { status: D > 0 ? 'available' : 'no_positive_contribution', fixedCost: fixed, variableCost: variable, contributionMarginPct: margin * 100,
      revenue: D > 0 ? fixed / margin : null, volumeIndex: D > 0 ? fixed / D : null, requiredVolumeChangePct: D > 0 ? (fixed / D - 1) * 100 : null, safetyMarginPct: D > 0 ? (revenue - fixed / margin) / revenue * 100 : null };
  }
  return row;
}
export function computeEntities(input, model, validation) {
  const companies = input.companies.map(c => companyResult(c, input, model));
  const scenarios = [{ id: 'pessimistic', label: '恶化压力', direction: -1 }, { id: 'base', label: '当前假设', direction: 0 }, { id: 'optimistic', label: '改善压力', direction: 1 }].map(item => ({ ...item,
    companies: input.companies.map(c => { const s = { ...c.scenario }; if (s.affected && item.direction) for (const [key, sign] of [['pricePct', 1], ['volumePct', 1], ['costPct', -1]]) { const spec = ENTITY_PARAMS[key]; s[key] = Math.max(spec.min, Math.min(spec.max, s[key] + item.direction * sign * 5)); } return companyResult(c, input, model, s); }),
    note: '受影响对象售价／销量 ±5 个百分点、成本 ∓5 个百分点；未受影响对象不变。是压力组合，不是概率或置信区间。' }));
  const first = input.companies.find(c => companies.find(r => r.id === c.id)?.status === 'estimated' && c.scenario.affected);
  const target = first?.fixedOperatingCost != null ? 'operatingProfit' : 'grossProfit';
  const sensitivity = first ? entityParams(model.id).map(key => { const spec = ENTITY_PARAMS[key], step = key === 'passThroughPct' ? 20 : key === 'lagMonths' ? 1 : 5, low = Math.max(spec.min, first.scenario[key] - step), high = Math.min(spec.max, first.scenario[key] + step); return { key, label: key === 'costPct' && model.id !== 'cost_transmission' ? '单位变动成本变化' : spec.label, companyId: first.id, target, low, high, unit: spec.unit, lowDelta: companyResult(first, input, model, { ...first.scenario, [key]: low }).delta?.[target] ?? null, highDelta: companyResult(first, input, model, { ...first.scenario, [key]: high }).delta?.[target] ?? null }; }) : [];
  const ranked = companies.filter(c => c.status === 'estimated').sort((a, b) => b.delta.grossProfit - a.delta.grossProfit);
  const item = c => c ? { id: c.id, name: c.name, grossProfitDelta: c.delta.grossProfit } : null;
  return { schemaVersion: '1.0', methodVersion: '1.2.0', modelId: model.id, modelTitle: model.title, context: { ...input.context }, parameters: { horizonMonths: input.parameters.horizonMonths }, eventMapping: input.analysis.eventMapping || null, scenarioMode: 'entity', companies, scenarios, sensitivity,
    summary: { headline: `${input.context.eventDescription}：${companies.filter(c => c.affected).length} 个对象受影响，${companies.filter(c => !c.affected).length} 个对象保持不变；不自动沿上下游传播。`, best: item(ranked[0]), worst: item(ranked.at(-1)), missingCount: companies.length - ranked.length },
    baselineReview: input.analysis.baselineReview || null, warnings: validation.warnings, methods: [{ id: model.id, label: model.title, version: '1.2.0', formulas: model.formulas, assumptions: model.assumptions }], createdAt: new Date().toISOString() };
}
