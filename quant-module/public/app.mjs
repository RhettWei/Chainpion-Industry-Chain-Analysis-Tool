import { runEventStudy } from '/src/core.mjs';
import { computeQuant as computeOperating, validateQuant as validateInput, MODEL_CATALOG, BASELINE_FIELDS, modelFor } from '/src/models.mjs';
import { installWorkflow } from '/workflow.mjs';
import { acquisitionRoute } from '/preparation.mjs';
import { DEMO_INPUT, DEMO_MARKET_DATA, emptyInput } from '/src/demo.mjs';
import { ask } from '/dialogs.mjs';
import { upgradeEntities, neutralScenario, ENTITY_PARAMS, entityParams } from '/src/scenarios.mjs';
import { scenarioText } from '/entity-workflow.mjs';
import { renderImpactCharts, renderMarketBars } from '/impact-charts.mjs';
import { formatValue, signedValue, valueClass } from '/src/display.mjs';

const $ = id => document.getElementById(id);
const clone = value => structuredClone(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const fmt = (value, digits = 1) => formatValue(value, digits, '待补数据');
const signed = signedValue;
const color = valueClass;
const roles = { upstream: '上游', midstream: '中游', downstream: '下游', other: '其他环节' };
const fieldLabels = { baselineRevenue: '基线收入（万元）', baselineGrossMarginPct: '基线毛利率（%）', rawMaterialCostSharePct: '原料占营业成本（%）', variableCostSharePct: '变动成本占营业成本（%）', fixedOperatingCost: '固定经营费用（万元，可选）' };
const paramSpecs = [
  { key: 'shockPct', label: '价格冲击', min: -90, max: 200, step: 1, unit: '%', note: '成本渠道为原料涨跌，售价渠道为产品涨跌。' },
  { key: 'volumePct', label: '销量变化', min: -90, max: 100, step: 1, unit: '%', note: '独立销量假设，不自动推断需求弹性。' },
  { key: 'passThroughPct', label: '成本转嫁率', min: 0, max: 100, step: 1, unit: '%', note: '成本涨跌中，通过售价传给客户的比例。' },
  { key: 'exposurePct', label: '业务暴露', min: 0, max: 100, step: 1, unit: '%', note: '指定价格冲击覆盖的业务比例。' },
  { key: 'lagMonths', label: '传导时滞', min: 0, max: 36, step: 1, unit: '月', note: '简化为时滞后开始传导，不模拟库存消化。' },
  { key: 'horizonMonths', label: '分析期限', min: 1, max: 36, step: 1, unit: '月', note: '基线金额须与此期间一致，模型不自动年化。' },
];
let saved = [];
try { saved = JSON.parse(localStorage.getItem('futurechain-quant-scenarios') || '[]').filter(item => item?.input && validateInput(item.input).valid).slice(-15); } catch { /* A restricted browser can run without storage. */ }
const state = { input: clone(DEMO_INPUT), initial: clone(DEMO_INPUT.parameters), mode: '演示假设', selected: DEMO_INPUT.companies[1].id, result: null, marketData: clone(DEMO_MARKET_DATA), marketResult: null, marketMode: '演示合成行情', saved, view: 'setup', modelChosen: false, confirmed: false, calculated: false, usage: { requests: 0, cacheHits: 0 } };
state.input.analysis = { model: 'cost_transmission' };
upgradeEntities(state.input, { demo: true });
const workflow = installWorkflow({ state, update, renderEditors, renderControls, switchView, notice, updateMarket, showModel: null });

function notice(message, type = '') { $('notice').textContent = message; $('notice').className = `notice ${type}`; $('notice').hidden = !message; }
function safeUrl(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; } }
function download(content, name, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const id = prefix => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
function switchView(view) { if(view==='overview' && modelFor(state.input).id==='event_study') view='market'; state.view = view; document.body.dataset.view = view; document.querySelectorAll('.view').forEach(el => { el.hidden = el.id !== `view-${view}`; }); document.querySelectorAll('.nav').forEach(el => el.classList.toggle('active', el.dataset.view === view || (view==='market'&&el.dataset.view==='overview'))); document.querySelector('.crumb').textContent = `产业链研究 Agent / 量化模块 / ${{ setup: '选择模型', overview: '结果与探索', companies: '基准准备', review:'审核与确认', market: '市场结果与行情', evidence: '资料与方法' }[view]}`; if (view === 'companies') renderEditors(); window.scrollTo({top:0,behavior:'instant'}); }
function selectedResult() { return state.result?.companies.find(company => company.id === state.selected) || state.result?.companies[0]; }
function update() {
  const validation = validateInput(state.input);
  try { state.result = state.calculated && state.confirmed ? computeOperating(state.input, { marketData: state.marketData, before: Number($('window-before').value), after: Number($('window-after').value) }) : null; } catch { state.result = null; }
  $('industry-title').textContent = state.input.context.industry || '新建研究';
  $('event-title').textContent = state.input.context.eventDescription || '请先描述研究事件，补充企业基线。';
  $('event-date').textContent = state.input.context.eventDate || '待设定'; $('asof-date').textContent = state.input.context.asOf || '待设定';
  $('mode-tag').textContent = state.mode; $('mode-tag').className = `tag ${state.mode === '演示假设' ? 'warning' : 'user'}`;
  if (!state.input.companies.some(company => company.id === state.selected)) state.selected = state.input.companies[0]?.id;
  $('parameter-status').textContent = state.result ? `已复算 · ${modelFor(state.input).title}` : validation.valid ? '待确认基准' : `待修正：${validation.errors[0]}`;
  renderOperating(validation); renderEvidence(); renderComparison();
  $('request-count').textContent = state.usage.requests; $('cache-count').textContent = state.usage.cacheHits;
  workflow.render();
}
function metric(label, value, unit = '', className = '', note = '') { return `<div class="metric"><span>${esc(label)}</span><strong class="${className}">${esc(value)}<small>${esc(unit)}</small></strong>${note ? `<p>${esc(note)}</p>` : ''}</div>`; }
function renderOperating(validation) {
  const result = state.result, company = selectedResult();
  const available = result?.companies.filter(item => item.status === 'estimated') || [];
  $('mobile-impact').innerHTML = company?.status === 'estimated' ? `${esc(company.name)} · 毛利变化 <strong class="${color(company.delta.grossProfit)}">${signed(company.delta.grossProfit)} 万元</strong>` : '待计算';
  $('headline').textContent = available.length ? `${company?.name || '所选对象'}：毛利 ${signed(company?.delta?.grossProfit)} 万元` : '待计算';
  $('summary-note').textContent = available.length ? `${result.companies.filter(c=>c.affected).length} 个受影响 · ${result.companies.filter(c=>!c.affected).length} 个保持基线` : (validation.errors[0] || '基准待补齐');
  $('result-event-definition').textContent = state.input.companies.find(c=>c.id===state.selected) ? scenarioText(state.input.companies.find(c=>c.id===state.selected), modelFor(state.input).id) : '';
  $('metrics').innerHTML = company?.status === 'estimated' ? [
    metric(`${company.name} · 毛利变化`, signed(company.delta.grossProfit), '万元', color(company.delta.grossProfit)),
    metric('情景毛利率', fmt(company.scenario.grossMarginPct), '%', color(company.delta.grossMarginPp), `较基线 ${signed(company.delta.grossMarginPp)} 个百分点`),
    metric('经营利润变化', signed(company.delta.operatingProfit), '万元', color(company.delta.operatingProfit), company.delta.operatingProfit === undefined ? '未填固定经营费用' : ''),
  ].join('') : metric('可计算企业', String(available.length), ` / ${state.input.companies.length} 家`, '', '缺失参数不会按零处理');
  const breakEven = modelFor(state.input).id === 'break_even';
  $('explore-title').textContent = breakEven ? '量价经营安全区' : '双参数情景矩阵';
  $('explore-note').textContent = breakEven ? '经营利润（万元）· 点击色块调整当前对象' : '毛利变化（万元）· 点击色块调整当前对象';
  if (breakEven && company?.status === 'estimated') {
    const point = company.breakEven;
    $('headline').textContent = `${company.name}：情景经营利润 ${signed(company.scenario.operatingProfit)} 万元`;
    $('summary-note').textContent = point.revenue == null ? '贡献毛益非正：提高销量不能得到有限正向盈亏平衡门槛。' : `按当前价格、单位成本和费用，盈亏平衡收入 ${fmt(point.revenue)} 万元；销量较基线达到 ${signed(point.requiredVolumeChangePct)}% 时经营利润为零。`;
    $('metrics').innerHTML = [
      metric('当前经营利润', signed(company.scenario.operatingProfit), '万元', color(company.scenario.operatingProfit), `基线 ${fmt(company.baseline.operatingProfit)} 万元；变化 ${signed(company.delta.operatingProfit)} 万元`),
      metric('盈亏平衡收入', point.revenue == null ? '无有限门槛' : fmt(point.revenue), point.revenue == null ? '' : '万元', ''),
      metric('当前安全边际', Number.isFinite(point.safetyMarginPct) ? signed(point.safetyMarginPct) : '不适用', Number.isFinite(point.safetyMarginPct) ? '%' : '', color(point.safetyMarginPct)),
    ].join('');
    $('mobile-impact').innerHTML = `${esc(company.name)} · 经营利润 <strong class="${color(company.scenario.operatingProfit)}">${signed(company.scenario.operatingProfit)} 万元</strong>`;
  }
  $('chain').innerHTML = state.input.companies.map(item => {
    const calculated = result?.companies.find(row => row.id === item.id);
    return `<button class="chain-node ${item.id === state.selected ? 'selected' : ''}" data-company="${esc(item.id)}"><span class="tag ${item.scenario?.affected ? 'warning' : 'subtle'}">${esc(roles[item.role] || item.role || '未分类')} · ${item.scenario?.affected ? '受影响' : '保持基线'}</span><h3>${esc(item.name)}</h3><p>${esc(scenarioText(item, modelFor(state.input).id))}</p><strong class="${color(calculated?.delta?.grossProfit)}">${signed(calculated?.delta?.grossProfit)} <small>万元</small></strong><span class="node-foot">${calculated?.status === 'estimated' ? '毛利变化' : '待计算'}</span></button>`;
  }).join('');
  $('company-select').innerHTML = state.input.companies.map(item => `<option value="${esc(item.id)}" ${item.id === state.selected ? 'selected' : ''}>${esc(item.name)}</option>`).join('');
  $('bridge-title').textContent = `${company?.name || '企业'}：毛利变化来自哪里`;
  $('waterfall').innerHTML = company?.status === 'estimated' ? waterfall(company) : '<div class="empty">基准待补齐</div>';
  $('bridge-explanation').textContent = company?.status === 'estimated' ? `毛利 ${fmt(company.baseline.grossProfit)} → ${fmt(company.scenario.grossProfit)} 万元 · 生效比例 ${fmt(company.scenario.activeShare * 100)}%` : (company?.limitations || []).join(' ');
  $('scenario-table').innerHTML = result ? `<table><thead><tr><th>企业 / 作用渠道</th>${result.scenarios.map(row => `<th>${esc(row.label)}</th>`).join('')}<th>当前毛利率变化</th></tr></thead><tbody>${result.companies.map(item => `<tr><td><button class="text-button" data-trace="${esc(item.id)}">${esc(item.name)} ↗</button><small>${esc(item.scope?.product || '明确范围')}</small></td>${result.scenarios.map(row => { const scenario = row.companies.find(c => c.id === item.id); const delta = scenario?.delta?.grossProfit; const description = scenario?.parameters ? `售价 ${scenario.parameters.pricePct}%；成本 ${scenario.parameters.costPct}%；销量 ${scenario.parameters.volumePct}%；让利/转嫁 ${scenario.parameters.passThroughPct}%` : '必要基准缺失'; return `<td class="heat ${color(delta)}" title="${esc(description)}">${signed(delta)}</td>`; }).join('')}<td class="${color(item.delta?.grossMarginPp)}">${signed(item.delta?.grossMarginPp)} pp</td></tr>`).join('')}</tbody></table>` : '<p class="empty">待计算</p>';
  $('scenario-note').textContent = result ? result.scenarios[0]?.note || '' : '';
  let sensitivity = [];
  if (company?.status === 'estimated') sensitivity = computeOperating({ ...state.input, analysis:{model:modelFor(state.input).id, scenarioMode:'entity'}, companies: state.input.companies.filter(row => row.id === company.id) }).sensitivity;
  $('tornado').innerHTML = sensitivity.length ? tornado(sensitivity, company.delta[sensitivity[0].target || 'grossProfit']) : '<p class="empty">暂无敏感性结果</p>';
  $('sensitivity-note').textContent = `${company?.name || '所选企业'} · 相对当前${sensitivity[0]?.target==='operatingProfit'?'经营利润':'毛利'}变化（万元）`;
  const missing = validation.missing.flatMap(row => row.fields.map(field => `${row.name}：补充${fieldLabels[field]}及来源`));
  const gaps = [...validation.errors, ...missing, ...validation.warnings];
  $('gaps-card').hidden = gaps.length === 0;
  $('gaps').innerHTML = [...new Set(gaps)].map(text => `<li>${esc(text)}</li>`).join('');
  renderImpactCharts(state);
}
function svgStart(width, height, title) { return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}" style="font-family:Microsoft YaHei,Arial,sans-serif;background:#fff"><title>${esc(title)}</title>`; }
function waterfall(company) {
  const rows = [{ label: '基线毛利', value: company.baseline.grossProfit, total: true }, ...company.bridge, { label: '情景毛利', value: company.scenario.grossProfit, total: true }];
  let running = 0;
  const bars = rows.map((row, index) => { const from = row.total ? 0 : running, to = row.total ? row.value : running + row.value; running = to; return { ...row, from, to, index }; });
  const low = Math.min(0, ...bars.flatMap(row => [row.from, row.to])), high = Math.max(1, ...bars.flatMap(row => [row.from, row.to]));
  const pad = (high - low) * .15, y = value => 225 - (value - low + pad) / (high - low + pad * 2) * 190;
  let svg = svgStart(760, 305, `${company.name}毛利桥接图（万元）`);
  for (let i = 0; i < 4; i++) { const v = low + (high - low) * i / 3; svg += `<line x1="55" y1="${y(v)}" x2="745" y2="${y(v)}" stroke="#e8eef1"/><text x="49" y="${y(v) + 4}" text-anchor="end" fill="#71828c" font-size="11">${fmt(v, 0)}</text>`; }
  svg += `<line x1="55" x2="745" y1="${y(0)}" y2="${y(0)}" stroke="#aabac3"/>`;
  bars.forEach((row, i) => {
    const spacing = 675 / bars.length, width = spacing * .68, x = 63 + i * spacing, top = Math.min(y(row.from), y(row.to)), height = Math.max(2, Math.abs(y(row.from) - y(row.to))), fill = row.total ? '#153b4b' : color(row.value) === 'positive' ? '#159b80' : color(row.value) === 'negative' ? '#d87157' : '#a0adb7';
    if (i > 0 && !row.total) svg += `<line x1="${x - 30}" x2="${x}" y1="${y(row.from)}" y2="${y(row.from)}" stroke="#aabac3" stroke-dasharray="3 3"/>`;
    svg += `<g><title>${esc(row.label)}：${fmt(row.value)} 万元</title><rect x="${x}" y="${top}" width="${width}" height="${height}" rx="3" fill="${fill}"/><text x="${x + width/2}" y="${top - 9}" text-anchor="middle" font-size="12" fill="${fill}">${row.total ? fmt(row.value, 0) : signed(row.value, 0)}</text><text x="${x + width/2}" y="258" text-anchor="middle" fill="#4b6470" font-size="10">${esc(row.total ? row.label : {volume_revenue:'销量收入',pricing_revenue:'直接调价',pass_revenue:'转嫁／让利',volume_cost:'销量成本',raw_shock:'成本变化'}[row.id] || row.label)}</text></g>`;
  });
  return `${svg}<text x="55" y="290" font-size="11" fill="#71828c">金额单位：万元 · 悬停查看数值</text></svg>`;
}
function tornado(rows, current) {
  const ordered = [...rows].sort((a, b) => Math.abs(b.highDelta - b.lowDelta) - Math.abs(a.highDelta - a.lowDelta));
  const extent = Math.max(1, ...ordered.flatMap(row => [Math.abs((row.lowDelta ?? current) - current), Math.abs((row.highDelta ?? current) - current)]));
  const center = 430, x = value => center + value / extent * 220;
  let svg = svgStart(760, 70 + ordered.length * 52, '单参数利润敏感性（万元）');
  svg += `<line x1="${center}" x2="${center}" y1="22" y2="${40 + ordered.length * 52}" stroke="#b6c6ce"/><text x="${center}" y="15" text-anchor="middle" fill="#607681" font-size="11">当前情景（0）</text>`;
  ordered.forEach((row, i) => { const low = row.lowDelta === null ? null : row.lowDelta - current, high = row.highDelta === null ? null : row.highDelta - current, y = 34 + i * 52;
    svg += `<text x="5" y="${y + 15}" fill="#304f5d" font-size="12">${esc(row.label)} (${row.low}–${row.high}${row.unit})</text>`;
    for (const [value, fill, offset, label] of [[low, '#97cbbf', 0, '低参数'], [high, '#1b776b', 14, '高参数']]) if (value !== null) svg += `<g><title>${esc(row.label)} · ${label}：${signed(value)} 万元（相对当前情景）</title><rect x="${Math.min(center, x(value))}" y="${y + offset}" width="${Math.max(2, Math.abs(x(value) - center))}" height="12" rx="2" fill="${fill}"/><text x="${x(value) + (value < 0 ? -5 : 5)}" y="${y + offset + 10}" text-anchor="${value < 0 ? 'end' : 'start'}" fill="#47616d" font-size="10">${signed(value, 0)}</text></g>`;
  });
  return `${svg}<rect x="5" y="${47 + rows.length * 52}" width="10" height="10" fill="#97cbbf"/><text x="20" y="${56 + rows.length * 52}" font-size="11" fill="#607681">低参数</text><rect x="90" y="${47 + rows.length * 52}" width="10" height="10" fill="#1b776b"/><text x="105" y="${56 + rows.length * 52}" font-size="11" fill="#607681">高参数</text></svg>`;
}
function renderControls() {
  const model = modelFor(state.input);
  const company = state.input.companies.find(c=>c.id===state.selected) || state.input.companies[0];
  $('control-company').innerHTML = state.input.companies.map(c=>`<option value="${esc(c.id)}" ${c.id===company?.id?'selected':''}>${esc(c.name)} · ${esc(c.scope?.product || '产品待明确')}</option>`).join('');
  $('control-scope').textContent = company ? scenarioText(company, model.id) : '请先添加对象';
  $('parameter-controls').innerHTML = model.id === 'event_study' ? '' : entityParams(model.id).map(key => {
    const spec = ENTITY_PARAMS[key], value = company?.scenario?.[key] ?? 0;
    const label = key === 'costPct' ? model.id === 'cost_transmission' ? `${company?.scope?.costItem || '指定成本项'}单价变化` : '该业务单位变动成本变化' : spec.label;
    return `<div class="parameter"><label for="param-${key}">${esc(label)}<output id="output-${key}">${value}${spec.unit}</output></label><input type="range" id="param-${key}" data-param="${key}" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${value}" ${company?.scenario?.affected ? '' : 'disabled'} style="--fill:${(value - spec.min) / (spec.max - spec.min) * 100}%"></div>`;
  }).join('');
}
function renderEditors() {
  const model = modelFor(state.input), fields = [...new Set([...model.required, 'fixedOperatingCost'])];
  $('company-editors').innerHTML = state.input.companies.map(company => `<article class="company-editor" data-editor="${esc(company.id)}"><div class="editor-head"><h3>${esc(company.name)}</h3><button class="text-button danger" data-remove-company="${esc(company.id)}">删除企业</button></div><div class="editor-grid"><label>企业名称<input data-field="name" value="${esc(company.name)}"></label><label>产业链位置<select data-field="role">${Object.entries(roles).map(([key, label]) => `<option value="${key}" ${company.role === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${model.id === 'cost_transmission' && state.input.analysis.scenarioMode !== 'entity' ? `<label>冲击作用渠道<select data-field="shockChannel"><option value="cost" ${company.shockChannel === 'cost' ? 'selected' : ''}>原料成本冲击</option><option value="selling_price" ${company.shockChannel === 'selling_price' ? 'selected' : ''}>产品售价冲击</option></select></label>` : ''}${fields.map(key => { const field=BASELINE_FIELDS[key], route=acquisitionRoute(state,company,key); return `<div class="baseline-field"><label title="${esc(field.note)}">${esc(field.label)}（${field.unit} · ${model.required.includes(key)?'必填':'可选'}）<input type="number" data-field="${key}" value="${company[key] ?? ''}" ${route==='assumption'?'':'disabled'} step="any" placeholder="未知请留空"></label><span class="tag ${route==='assumption'?'warning':'user'}">${{assumption:'情景假设',materials:'从资料提取',online:'联网补齐'}[route]}</span></div>`; }).join('')}</div><small>对象 ID：${esc(company.id)}</small></article>`).join('');
}
function renderEvidence() {
  $('evidence-list').innerHTML = state.input.evidence.length ? state.input.evidence.map(row => { const url = safeUrl(row.url); return `<article class="source-card"><div><span class="tag ${row.kind === 'assumption' ? 'warning' : row.kind}">${{ assumption: '情景假设', observed: '已观测数据', user: '用户资料' }[row.kind]}</span><h3>${esc(row.title)}</h3><p>${esc(row.source)}${row.publishedAt ? ` · ${esc(row.publishedAt)}` : ''}</p>${row.locator || row.description ? `<details><summary>来源摘录</summary><p>${esc(row.locator || '')}</p>${row.description ? `<p>${esc(row.description)}</p>` : ''}</details>` : ''}${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">查看原始资料 ↗</a>` : ''}<small>资料 ID：${esc(row.id)}</small></div><button class="text-button danger" data-remove-evidence="${esc(row.id)}">删除</button></article>`; }).join('') : '<p class="empty">暂无资料</p>';
  const model = modelFor(state.input), methods = state.result?.methods || [{ label: model.title, version: '1.1.0', formulas: model.formulas, assumptions: model.assumptions }];
  $('methods').innerHTML = methods.map(method => `<article class="method-item"><h3>${esc(method.label)} <span class="tag subtle">v${esc(method.version)}</span></h3>${method.formulas.map(formula => `<p>${esc(formula)}</p>`).join('')}<ul>${method.assumptions.map(item => `<li>${esc(item)}</li>`).join('')}</ul></article>`).join('') + '<article class="method-item"><h3>市场调整事件研究</h3><p>调整后收盘价 = 收盘价 × 复权因子；日收益 = 当日价格 / 前一共同交易日价格 − 1。</p><p>AR = 个股日收益 − 同期基准日收益；CAR = 指定事件窗口中每日 AR 的加总。</p><p>组合固定有效证券样本，等权并仅使用共同有效日收益。成交量 Z 值以事件前最多 60 日、至少 20 日作基线。最大回撤从所选窗口价格计算。</p><p>可选择事件前OLS市场模型；未输出 p 值、未控制同期混杂事件，不能解释为因果效应。</p></article>';
}
function showTrace(companyId = state.selected) {
  const row = state.result?.companies.find(company => company.id === companyId), input = state.input.companies.find(company => company.id === companyId);
  if (!input) return;
  $('trace-title').textContent = `${input.name} · 计算依据`;
  const model = modelFor(state.input), activeFields = [...new Set([...model.required, 'fixedOperatingCost'])];
  $('trace-content').innerHTML = `<section class="trace-section"><h3>${esc(model.title)} · 原始参数 · ${esc(state.input.context.periodLabel)}</h3><table><tbody>${activeFields.map(key => `<tr><td>${esc(BASELINE_FIELDS[key].label)}（${BASELINE_FIELDS[key].unit}）</td><td>${input[key] == null ? '未知' : fmt(input[key])}</td></tr>`).join('')}</tbody></table></section><section class="trace-section"><h3>当前情景假设</h3><p>${esc(scenarioText(input, model.id))}</p><button class="text-button" data-open-model>查看本模型完整公式 ↗</button><p>金额与期间不自动转换。经营利润是模型简化口径，不等于财报营业利润或净利润。</p></section>${row?.status === 'estimated' ? `<section class="trace-section"><h3>计算桥接（万元）</h3><table><tbody><tr><td>基线毛利</td><td>${fmt(row.baseline.grossProfit)}</td></tr>${row.bridge.map(part => `<tr><td>${esc(part.label)}</td><td>${signed(part.value)}</td></tr>`).join('')}<tr><td>情景毛利</td><td>${fmt(row.scenario.grossProfit)}</td></tr></tbody></table></section>` : ''}<section class="trace-section"><h3>引用资料</h3>${state.input.evidence.filter(item => input.evidenceIds?.includes(item.id)).map(item => `<p>${esc(item.title)} · ${esc(item.source)} · ${esc(item.locator || item.publishedAt || '未定位')}</p>`).join('') || '<p>未绑定资料，结果只能作为未验证假设。</p>'}</section><section class="trace-section"><h3>限制与缺口</h3><ul>${(row?.limitations || ['先确认基准并计算。']).map(text => `<li>${esc(text)}</li>`).join('')}</ul></section>`;
  $('trace-dialog').showModal();
  $('trace-content').insertAdjacentHTML('afterbegin', `<section class="trace-section"><h3>明确的事件与作用对象</h3><p>${esc(state.input.context.eventDescription)}</p><p>${esc(scenarioText(input, model.id))}</p><p>范围：${esc(input.scope?.level)}；产品：${esc(input.scope?.product)}；成本项：${esc(input.scope?.costItem || '未施加成本变化')}。</p></section>`);
}
function renderSaved() { $('saved-select').innerHTML = '<option value="">选择已保存情景</option>' + state.saved.map(row => `<option value="${esc(row.id)}">${esc(row.name)}</option>`).join(''); renderComparison(); }
function persistSaved() { try { localStorage.setItem('futurechain-quant-scenarios', JSON.stringify(state.saved)); } catch { notice('当前浏览器不允许保存到本地；本次会话仍可比较情景。', 'warning'); } }
function renderComparison() {
  const snapshot = state.saved.find(row => row.id === $('saved-select').value); $('saved-remove').hidden = !snapshot;
  if (!snapshot) { $('saved-comparison').innerHTML = ''; return; }
  if (!state.result) { $('saved-comparison').textContent = '先确认基准并计算，再比较已保存情景。'; return; }
  const previous = computeOperating(snapshot.input), current = selectedResult(), before = previous.companies.find(row => row.id === current?.id);
  const aligned = modelFor(snapshot.input).id === modelFor(state.input).id && JSON.stringify(snapshot.input.companies.map(({scenario,...rest})=>rest)) === JSON.stringify(state.input.companies.map(({scenario,...rest})=>rest)) && snapshot.input.context.periodLabel === state.input.context.periodLabel;
  $('saved-comparison').innerHTML = `<p>${esc(snapshot.name)}</p><strong class="${color(current?.delta?.grossProfit - before?.delta?.grossProfit)}">${signed(current?.delta?.grossProfit - before?.delta?.grossProfit)} 万元</strong><small>${esc(current?.name || '')}毛利变化，相对已存情景${aligned ? '' : '；模型／基线／企业已变更，不可仅归因参数差异'}</small>`;
}
function updateMarket() {
  const result = runEventStudy({ ...state.marketData, eventDate: state.input.context.eventDate, asOf: state.input.context.asOf, before: Number($('window-before').value), after: Number($('window-after').value), expectedReturnModel: state.input.analysis.marketMethod || 'market_adjusted' }); state.marketResult = result;
  $('market-method').value = state.input.analysis.marketMethod || 'market_adjusted';
  $('market-estimation').textContent = result.expectedReturnModel === 'market_model' ? `OLS · ${result.companies.map(c=>c.estimation?`${c.name}：α=${fmt(c.estimation.alpha,4)}%/日，β=${fmt(c.estimation.beta,3)}，R²=${fmt(c.estimation.rSquared,3)}，${c.estimation.sampleDays}日（${c.estimation.startDate}～${c.estimation.endDate}）`:`${c.name}：估计不可用`).join('；')}` : 'α=0、β=1';
  const last = result.series.at(-1), available = result.status === 'available';
  $('market-mode').textContent = state.marketMode; $('market-mode').className = `tag ${state.marketData.provenance?.kind === 'assumption' ? 'warning' : state.marketData.provenance?.kind === 'user' ? 'user' : 'observed'}`;
  $('market-loaded').innerHTML = `<strong>已载入样本</strong><p>${state.marketData.companies.map(c => `${esc(c.name || c.id)} · ${esc(c.id)}`).join('；') || '尚未载入'}</p><small>基准：${esc(state.marketData.provenance?.params?.benchmarkCode || state.marketData.provenance?.benchmarkCode || (state.marketData.provenance?.kind === 'assumption' ? '演示合成基准（无真实指数代码）' : '导入的基准序列（代码未标明）'))}；来源：${esc(state.marketData.provenance?.provider || '未提供')}</small>`;
  if (modelFor(state.input).id !== 'event_study' || !state.confirmed || !state.calculated) {
    $('market-metrics').innerHTML = ''; $('market-chart').innerHTML = '<div class="empty">确认行情基准后计算</div>';
    $('market-impact-bars').innerHTML = '<p class="empty">待计算</p>';
    $('market-response-matrix').innerHTML = '<p class="empty">待计算</p>';
    $('market-table').innerHTML = `<table><thead><tr><th>行情样本</th><th>价格记录</th><th>来源</th></tr></thead><tbody>${state.marketData.companies.map(company => `<tr><td>${esc(company.name || company.id)}</td><td>${company.prices.length}</td><td>${esc(state.marketMode)}</td></tr>`).join('')}<tr><td>市场基准</td><td>${state.marketData.benchmark.length}</td><td>${esc(state.marketData.provenance?.provider || state.marketMode)}</td></tr></tbody></table>`;
    $('market-warnings').textContent = result.warnings.join(' '); return;
  }
  $('market-metrics').innerHTML = [metric('组合累计异常收益 CAR', signed(last?.car, 2), 'pp', color(last?.car, 2), `${available ? '完整' : '不完整或不可用'}窗口 · ${result.series.length} 个共同有效日`), metric('组合累计收益', signed(last?.portfolioCumulative, 2), '%', color(last?.portfolioCumulative, 2), '窗口复利收益'), metric('基准累计收益', signed(last?.benchmarkCumulative, 2), '%', '', result.tradingEventDate ? `T0：${result.tradingEventDate}` : '事件日无可用观测')].join('');
  $('market-chart').innerHTML = result.series.length ? lineChart(result.series) : '<div class="empty">无共同有效窗口</div>';
  renderMarketBars(result);
  $('market-table').innerHTML = `<table><thead><tr><th>证券样本</th><th>CAR（pp）</th><th>成交量 Z</th><th>最大回撤（%）</th><th>有效日</th></tr></thead><tbody>${result.companies.map(company => `<tr><td>${esc(company.name)}</td><td class="${color(company.car, 2)}">${signed(company.car, 2)}</td><td>${Number.isFinite(company.volumeZ) ? fmt(company.volumeZ, 2) : '待补数据'}</td><td>${signed(company.maxDrawdown, 2)}</td><td>${company.sampleDays}/${company.expectedDays}</td></tr>`).join('')}</tbody></table>`;
  const mismatch = state.marketData.eventDate && state.marketData.eventDate !== state.input.context.eventDate ? ['研究事件日期已调整；现有行情未重新抓取，请检查窗口覆盖。'] : [];
  $('market-warnings').textContent = [...mismatch, ...result.warnings, `来源：${state.marketData.provenance?.provider || state.marketMode}`].join(' ');
}
function lineChart(series) {
  const keys = [{ key: 'portfolioCumulative', label: '样本累计收益（%）', color: '#123e51' }, { key: 'benchmarkCumulative', label: '基准累计收益（%）', color: '#a0adb7' }, { key: 'car', label: 'CAR（pp）', color: '#159b80' }];
  const values = series.flatMap(row => keys.map(item => row[item.key])), low = Math.min(0, ...values), high = Math.max(.1, ...values), pad = (high - low) * .15;
  const minDay = Math.min(0, ...series.map(row => row.day)), maxDay = Math.max(0, ...series.map(row => row.day));
  const x = day => 60 + (day - minDay) / Math.max(1, maxDay - minDay) * 665, y = value => 244 - (value - low + pad) / (high - low + pad * 2) * 200;
  let svg = svgStart(760, 335, '事件窗口累计收益与异常收益');
  for (let i = 0; i < 5; i++) { const v = low + (high - low) * i / 4; svg += `<line x1="60" x2="725" y1="${y(v)}" y2="${y(v)}" stroke="#e7eef1"/><text x="50" y="${y(v) + 4}" text-anchor="end" fill="#71828c" font-size="11">${fmt(v, 2)}</text>`; }
  svg += `<line x1="${x(0)}" x2="${x(0)}" y1="30" y2="247" stroke="#ce9e49" stroke-dasharray="5 4"/><text x="${x(0)}" y="20" text-anchor="middle" fill="#b4802f" font-size="12">事件 T0${series.some(row => row.day === 0) ? '' : '（无共同收益）'}</text>`;
  keys.forEach(item => {
    series.forEach((row, i) => {
      const previous = series[i - 1];
      if (previous) svg += `<line x1="${x(previous.day)}" y1="${y(previous[item.key])}" x2="${x(row.day)}" y2="${y(row[item.key])}" stroke="${item.color}" stroke-width="2.5" ${row.day - previous.day > 1 ? 'stroke-dasharray="4 5"' : ''}/>`;
      svg += `<circle cx="${x(row.day)}" cy="${y(row[item.key])}" r="3.5" fill="${item.color}"><title>${row.date} · T${row.day > 0 ? '+' : ''}${row.day} · ${item.label}：${signed(row[item.key], 2)}；样本 ${row.n} 家</title></circle>`;
    });
  });
  series.forEach((row, i) => { if (i % Math.max(1, Math.ceil(series.length / 7)) === 0 || i === series.length - 1) svg += `<text x="${x(row.day)}" y="268" text-anchor="middle" fill="#71828c" font-size="11">T${row.day > 0 ? '+' : ''}${row.day}</text>`; });
  keys.forEach((item, i) => { svg += `<line x1="${65 + i * 225}" x2="${90 + i * 225}" y1="303" y2="303" stroke="${item.color}" stroke-width="3"/><text x="${98 + i * 225}" y="307" font-size="12" fill="#607681">${item.label}</text>`; });
  return `${svg}<text x="60" y="331" fill="#71828c" font-size="10">横轴为实际相对交易日；缺口区间用虚线，未填充收益。</text></svg>`;
}
async function fetchMarket() {
  const button = $('fetch-market'); button.disabled = true; $('market-progress').textContent = '正在获取行情与复权因子…'; notice('');
  try {
    const codes = $('market-codes').value.split(/[,，\s]+/).filter(Boolean), token = $('tushare-token').value.trim();
    const response = await fetch('/api/market-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventDate: state.input.context.eventDate, asOf: state.input.context.asOf, codes, benchmarkCode: $('benchmark-code').value.trim(), ...(token ? { token } : {}) }), signal: AbortSignal.timeout(150000) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || `取数失败（${response.status}）`);
    if (modelFor(state.input).id === 'event_study') workflow.invalidate();
    state.marketData = data; state.marketMode = 'Tushare 真实行情'; state.usage.requests += data.usage?.requests || 0; state.usage.cacheHits += data.usage?.cacheHits || 0;
    updateMarket(); update(); $('market-progress').textContent = `取数完成 · ${data.usage?.requests || 0} 次请求 · ${data.usage?.cacheHits || 0} 次缓存命中 · ${fmt((data.usage?.elapsedMs || 0) / 1000)} 秒。${(data.warnings || []).join(' ')}`;
  } catch (error) { $('market-progress').textContent = '取数未完成，原有数据仍保留。'; notice(`真实行情获取失败：${error.message}。请检查凭证权限、日期及证券代码；也可先导入行情文件。`, 'error'); }
  finally { button.disabled = false; $('tushare-token').value = ''; }
}
function loadInput(input, mode = '用户输入 / 待核验') {
  const validation = validateInput(input); if (!validation.valid) throw new Error(validation.errors.join(' '));
  // Only contract fields enter app state; credentials in an imported file are ignored.
  state.input = clone({ schemaVersion: input.schemaVersion,
    analysis: { model: modelFor(input).id, ...(input.analysis?.scenarioMode==='entity'?{scenarioMode:'entity'}:{}), ...(input.analysis?.marketMethod?{marketMethod:input.analysis.marketMethod}:{}) },
    context: Object.fromEntries(['industry', 'eventDescription', 'eventDate', 'asOf', 'periodLabel'].map(key => [key, input.context[key] || ''])),
    parameters: Object.fromEntries(paramSpecs.map(spec => [spec.key, input.parameters?.[spec.key] ?? emptyInput.parameters[spec.key]])),
    companies: (input.companies || []).map(company => ({ ...Object.fromEntries(['id', 'name', 'role', 'shockChannel', ...Object.keys(fieldLabels), 'evidenceIds'].filter(key => company[key] !== undefined).map(key => [key, company[key]])), ...(company.baselineSources ? { baselineSources: Object.fromEntries(Object.keys(BASELINE_FIELDS).filter(field => company.baselineSources[field]).map(field => [field, { kind: company.baselineSources[field].kind, ...(company.baselineSources[field].route?{route:company.baselineSources[field].route}:{}), ...(company.baselineSources[field].review?{review:Object.fromEntries(['status','reviewedAt','period'].map(key=>[key,company.baselineSources[field].review[key]]))}:{}), ...(typeof company.baselineSources[field].evidenceId === 'string' && company.baselineSources[field].evidenceId ? { evidenceId: company.baselineSources[field].evidenceId } : {}) }])) } : {}) })),
    evidence: (input.evidence || []).map(item => Object.fromEntries(['id', 'title', 'kind', 'source', 'url', 'locator', 'description', 'publishedAt', 'page'].filter(key => item[key] !== undefined && item[key] !== '').map(key => [key, item[key]]))),
  });
  state.input.companies.forEach((c,i)=>{ const original=input.companies[i]; if(original.scope)c.scope=Object.fromEntries(['level','product','costItem','unit'].map(k=>[k,original.scope[k]??''])); if(original.scenario)c.scenario=Object.fromEntries(['affected',...Object.keys(ENTITY_PARAMS)].map(k=>[k,original.scenario[k]])); });
  upgradeEntities(state.input, {demo:mode==='演示假设'});
  workflow.invalidate(); workflow.resetPreparation(); state.modelChosen = Boolean(input.analysis?.model); state.initial = clone(state.input.parameters); state.mode = mode; state.selected = state.input.companies[0]?.id; renderControls(); update(); renderEditors(); updateMarket(); switchView('setup'); notice('研究已载入，请确认基准。');
}
function parseCSV(text) {
  const rows = [], row = []; let cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); if (row.some(value => value.trim())) rows.push([...row]); row.length = 0; cell = ''; }
    else cell += c;
  }
  if (quoted) throw new Error('CSV 存在未闭合的引号。');
  row.push(cell); if (row.some(value => value.trim())) rows.push(row);
  const headers = (rows.shift() || []).map(value => value.replace(/^\uFEFF/, '').trim());
  return rows.map((values, index) => { if (values.length !== headers.length) throw new Error(`CSV 第 ${index + 2} 行列数不一致。`); return Object.fromEntries(headers.map((key, i) => [key, values[i].trim()])); });
}
const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
function csvString(headers, rows) { return '\uFEFF' + [headers.map(csvCell).join(','), ...rows.map(row => headers.map(key => csvCell(row[key])).join(','))].join('\r\n'); }
async function readInputFile(file) { if (!file) return; if (file.size > 3 * 1024 * 1024) throw new Error('研究 JSON 请控制在 3 MB 内。'); const parsed = JSON.parse(await file.text()); loadInput(parsed.input || parsed); $('settings-dialog').close(); }
async function importCompanies(file) {
  if (!file) return; if (file.size > 1024 * 1024) throw new Error('企业 CSV 请控制在 1 MB 内。');
  const rows = parseCSV(await file.text()); if (!rows.length) throw new Error('CSV 中没有企业数据。');
  const companies = rows.map((row, i) => ({ id: row.id || id('company'), name: row.name || `企业 ${i + 1}`, role: row.role || 'midstream', shockChannel: row.shockChannel || 'cost', ...Object.fromEntries(Object.keys(fieldLabels).map(key => [key, row[key] === undefined || row[key] === '' ? null : Number(row[key])])), evidenceIds: row.evidenceIds ? row.evidenceIds.split('|') : [] }));
  loadInput({ ...state.input, analysis:{model:modelFor(state.input).id}, companies }, '用户数据 / 待核验'); switchView('companies'); notice(`已导入 ${companies.length} 家企业`);
}
async function importMarket(file) {
  if (!file) return; if (file.size > 5 * 1024 * 1024) throw new Error('行情文件请控制在 5 MB 内。');
  let data;
  if (file.name.toLowerCase().endsWith('.csv')) {
    const rows = parseCSV(await file.text()), map = new Map(), benchmark = [], code = $('benchmark-code').value.trim();
    for (const row of rows) {
      const ticker = row.ts_code || row.id, price = { date: row.date, close: Number(row.close), volume: row.volume || row.vol ? Number(row.volume || row.vol) : undefined, ...(row.adjFactor ? { adjFactor: Number(row.adjFactor) } : {}) };
      if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(price.date) || !Number.isFinite(price.close) || price.close <= 0) throw new Error('行情 CSV 需要 ts_code、date（YYYY-MM-DD）、close；收盘价必须为正。');
      if (ticker === code || row.role === 'benchmark') benchmark.push(price);
      else { if (!map.has(ticker)) map.set(ticker, { id: ticker, name: row.name || ticker, role: row.role || 'other', prices: [] }); map.get(ticker).prices.push(price); }
    }
    data = { companies: [...map.values()], benchmark };
  } else { const parsed = JSON.parse(await file.text()); data = parsed.marketData || parsed; }
  if (!Array.isArray(data.companies) || !Array.isArray(data.benchmark) || !data.companies.length || !data.benchmark.length || data.companies.some(company => !company || !Array.isArray(company.prices))) throw new Error('行情需包含 companies[*].prices 和 benchmark 数组，且都有价格记录。');
  const assumption = data.provenance?.kind === 'assumption';
  if (modelFor(state.input).id === 'event_study') workflow.invalidate();
  state.marketData = { eventDate: data.eventDate || state.input.context.eventDate, companies: data.companies.map(company => ({ id: company.id, name: company.name, role: company.role, prices: company.prices.map(row => Object.fromEntries(['date', 'close', 'volume', 'adjFactor'].filter(key => row[key] !== undefined && row[key] !== null).map(key => [key, row[key]]))) })), benchmark: data.benchmark.map(row => ({ date: row.date, close: row.close })), provenance: { provider: `用户导入：${file.name}${data.provenance?.provider ? ` · ${data.provenance.provider}` : ''}`, description: data.provenance?.description || '用户导入，未经独立核验。', kind: assumption ? 'assumption' : 'user' } }; state.marketMode = assumption ? '导入演示 / 假设行情' : '用户导入行情 / 待核验'; update(); updateMarket(); notice('行情已导入');
}
function exportJSON() { download(JSON.stringify({ schemaVersion: '1.0', input: state.input, result: state.result, marketResult: state.confirmed && state.calculated && modelFor(state.input).id === 'event_study' ? state.marketResult : null, marketData: state.marketData, dataLabels: { operating: state.mode, market: state.marketMode }, exportedAt: new Date().toISOString() }, null, 2), '量化研究_对接包.json'); }
async function chartPNG(elementId, title) {
  const svg = $(elementId).querySelector('svg'); if (!svg) return null;
  let timer;
  try {
    const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    await Promise.race([image.decode(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('图表转换超时')), 5000); })]);
    const canvas = document.createElement('canvas'); canvas.width = 1520; canvas.height = Math.round(1520 * svg.viewBox.baseVal.height / svg.viewBox.baseVal.width);
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { title, png: canvas.toDataURL('image/png').split(',')[1] };
  } catch { return null; } finally { clearTimeout(timer); }
}
async function exportReport() {
  const format = $('export-format').value, button = $('export-confirm');
  if (format === 'json') { exportJSON(); $('export-dialog').close(); return; }
  if (!state.result) { notice('输入尚未有效，先补齐研究设置与参数再导出报告。', 'warning'); return; }
  if (format === 'csv' && modelFor(state.input).id === 'event_study') {
    const headers = ['id', 'name', 'status', 'carPp', 'volumeZ', 'maxDrawdownPct', 'sampleDays', 'expectedDays'];
    download(csvString(headers, state.marketResult.companies.map(company => ({ ...company, carPp: company.car, maxDrawdownPct: company.maxDrawdown }))), '市场事件研究结果.csv', 'text/csv;charset=utf-8'); $('export-dialog').close(); return;
  }
  if (format === 'csv') { const headers = ['id', 'name', 'role', 'status', 'baselineGrossProfit', 'scenarioGrossProfit', 'grossProfitDelta', 'grossMarginPp', 'operatingProfitDelta']; download(csvString(headers, state.result.companies.map(row => ({ ...row, baselineGrossProfit: row.baseline?.grossProfit, scenarioGrossProfit: row.scenario?.grossProfit, grossProfitDelta: row.delta?.grossProfit, grossMarginPp: row.delta?.grossMarginPp, operatingProfitDelta: row.delta?.operatingProfit }))), '企业量化结果_万元.csv', 'text/csv;charset=utf-8'); $('export-dialog').close(); return; }
  button.disabled = true; button.textContent = '正在整理图表与报告…'; notice('');
  try {
    const chartRequests = modelFor(state.input).id === 'event_study' ? [chartPNG('market-chart', `${state.marketMode} · 事件窗口`), chartPNG('market-impact-bars','各证券CAR比较'), chartPNG('market-response-matrix','每日AR反应分化矩阵（pp）')] : [chartPNG('impact-ranking','各对象影响比较（万元）'), chartPNG('waterfall', `${selectedResult()?.name || '企业'}毛利桥接（万元）`), chartPNG('impact-heatmap',modelFor(state.input).id === 'break_even' ? '量价经营安全区（经营利润万元）' : '双参数毛利变化矩阵（万元）')];
    const charts = (await Promise.all(chartRequests)).filter(Boolean);
    const response = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: state.input, result: state.result, ...(modelFor(state.input).id === 'event_study' ? { marketData: state.marketData, before: Number($('window-before').value), after: Number($('window-after').value), marketResult: { ...state.marketResult, dataProvenance: state.marketData.provenance } } : {}), format, detail: $('export-detail').value, charts, delivery: 'link' }), signal: AbortSignal.timeout(20000) });
    if (!response.ok) { const data = await response.json(); throw new Error(data.error || '报告生成失败'); }
    const link = await response.json();
    if (!/^\/api\/download\/[0-9a-f-]+$/i.test(link.url)) throw new Error('服务返回的下载地址无效。');
    const anchor = document.createElement('a'), hint = document.createElement('span'); anchor.href = link.url; anchor.download = link.filename; anchor.textContent = `点击下载：${link.filename} ↗`; anchor.style.fontWeight = '600'; hint.textContent = '　链接 5 分钟内有效；如果未自动下载，请点击此链接。';
    $('export-download').replaceChildren(anchor, hint); $('export-download').hidden = false; anchor.click();
    $('export-dialog').close(); notice(`报告已生成。${charts.length < chartRequests.length ? '部分图表未能转换，数值表与方法内容仍已保留。' : ''}`);
  } catch (error) { notice(`导出失败：${error.message}`, 'error'); }
  finally { button.disabled = false; button.textContent = '生成并下载'; }
}

document.querySelectorAll('.nav').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
$('mobile-controls-toggle').addEventListener('click', () => { const open = $('scenario-controls').classList.toggle('mobile-open'); $('mobile-controls-toggle').setAttribute('aria-expanded', String(open)); $('mobile-controls-toggle').textContent = open ? '收起参数 · 查看图表' : '调整情景参数'; });
$('parameter-controls').addEventListener('input', event => { const key = event.target.dataset.param, c = state.input.companies.find(c=>c.id===state.selected); if (!key || !c?.scenario?.affected) return; $('export-download').hidden = true; c.scenario[key] = Number(event.target.value); const spec = ENTITY_PARAMS[key]; $(`output-${key}`).textContent = `${event.target.value}${spec.unit}`; event.target.style.setProperty('--fill', `${(event.target.value - event.target.min) / (event.target.max - event.target.min) * 100}%`); $('control-scope').textContent=scenarioText(c,modelFor(state.input).id); update(); });
$('chain').addEventListener('click', event => { const target = event.target.closest('[data-company]'); if (target) { state.selected = target.dataset.company; renderControls(); update(); showTrace(); } });
for (const name of ['company-select','control-company']) $(name).addEventListener('change', event => { state.selected = event.target.value; renderControls(); update(); });
function adoptHeat(event) { const target=event.target.closest('[data-heat-company]'); if(!target || (event.type==='keydown'&&!['Enter',' '].includes(event.key)))return; event.preventDefault();const c=state.input.companies.find(c=>c.id===target.dataset.heatCompany);if(!c?.scenario.affected)return;c.scenario[target.dataset.heatKey]=Number(target.dataset.heatPrice);c.scenario.volumePct=Number(target.dataset.heatVolume);$('export-download').hidden=true;renderControls();update();notice('已采用参数组合'); }
$('impact-heatmap').addEventListener('click',adoptHeat);$('impact-heatmap').addEventListener('keydown',adoptHeat);
$('scenario-table').addEventListener('click', event => { const target = event.target.closest('[data-trace]'); if (target) showTrace(target.dataset.trace); });
$('trace-open').addEventListener('click', () => showTrace());
$('params-reset').addEventListener('click', () => { const c=state.input.companies.find(c=>c.id===state.selected);if(!c)return; $('export-download').hidden = true; c.scenario={...neutralScenario(),affected:c.scenario.affected}; renderControls(); update(); notice('参数已归零'); });
$('scenario-save').addEventListener('click', async () => { if (!state.result) { notice('先修正输入，再保存情景。', 'warning'); return; } const name = await ask({title:'保存当前情景', message:'情景名称', defaultValue:`情景 ${state.saved.length + 1} · ${state.input.companies.find(c=>c.id===state.selected)?.scope?.product || '逐对象情景'}`}); if (!name?.trim()) return; const snapshot = { id: id('scenario'), name: name.trim().slice(0, 80), input: clone(state.input), savedAt: new Date().toISOString() }; state.saved.push(snapshot); state.saved = state.saved.slice(-15); persistSaved(); renderSaved(); $('saved-select').value = snapshot.id; renderComparison(); });
$('saved-select').addEventListener('change', renderComparison);
$('saved-remove').addEventListener('click', () => { const selected = $('saved-select').value; state.saved = state.saved.filter(row => row.id !== selected); persistSaved(); renderSaved(); });
$('company-add').addEventListener('click', () => { workflow.invalidate(); state.input.companies.push({ ...clone(emptyInput.companies[0]), id: id('company'), name: `待补企业 ${state.input.companies.length + 1}`, scope:{level:'company',product:'',costItem:'',unit:'综合均价指数'},scenario:neutralScenario() }); state.mode = '用户输入 / 待核验'; renderEditors(); renderControls(); update(); });
$('company-editors').addEventListener('input', event => {
  const field = event.target.dataset.field, container = event.target.closest('[data-editor]'); if (!field || !container) return;
  const company = state.input.companies.find(row => row.id === container.dataset.editor);
  workflow.invalidate();
  company[field] = field === 'evidenceIds' ? [...event.target.selectedOptions].map(option => option.value) : field in fieldLabels ? event.target.value === '' ? null : Number(event.target.value) : event.target.value;
  if (field in fieldLabels) { company.baselineSources ||= {}; company.baselineSources[field] = { kind: 'assumption', route:'assumption' }; }
  if (field === 'name') container.querySelector('h3').textContent = company.name;
  state.mode = '用户输入 / 待核验'; update();
});
$('company-editors').addEventListener('click', async event => { const target = event.target.closest('[data-remove-company]'); if (!target) return; if (state.input.companies.length < 2) { notice('至少保留一家企业；未知数据可以留空。', 'warning'); return; } if (!await ask({title:'删除企业',message:'删除此企业及其在当前研究中的测算？已保存情景不受影响。'})) return; workflow.invalidate(); state.input.companies = state.input.companies.filter(row => row.id !== target.dataset.removeCompany); renderEditors(); update(); });
$('settings-open').addEventListener('click', () => { for (const [key, value] of Object.entries(state.input.context)) if ($('settings-form').elements.namedItem(key)) $('settings-form').elements.namedItem(key).value = value; $('settings-form').elements.namedItem('horizonMonths').value=state.input.parameters.horizonMonths; $('settings-dialog').showModal(); });
$('settings-form').addEventListener('submit', event => { event.preventDefault(); const form = new FormData(event.target), previous=state.input.context.eventDescription; workflow.invalidate(); state.input.context = Object.fromEntries(['industry', 'eventDescription', 'eventDate', 'asOf', 'periodLabel'].map(key => [key, String(form.get(key)).trim()])); state.input.parameters.horizonMonths=Number(form.get('horizonMonths')); if(previous!==state.input.context.eventDescription)state.input.companies.forEach(c=>c.scenario=neutralScenario()); if (state.mode === '演示假设') state.mode = '自定义研究 / 含演示基线'; renderControls();update(); updateMarket(); $('settings-dialog').close(); notice('研究已更新，请重新确认情景。'); });
$('new-input').addEventListener('click', async () => { if (!await ask({title:'新建研究',message:'新建研究将替换当前输入；请先导出需要保留的内容。已保存情景不会删除。'})) return; workflow.invalidate(); workflow.resetPreparation(); state.modelChosen = false; state.input = clone(emptyInput); state.input.analysis = { model: 'cost_transmission' }; upgradeEntities(state.input);state.input.parameters.shockPct=0;state.input.parameters.volumePct=0;state.input.context.asOf = new Date().toLocaleDateString('sv-SE'); state.initial = clone(state.input.parameters); state.mode = '用户输入 / 待补充'; state.marketData = { companies: [], benchmark: [], provenance: { provider: '尚未加载' } }; state.marketMode = '尚未加载行情'; renderControls(); update(); renderEditors(); updateMarket(); switchView('setup'); $('settings-open').click(); });
$('demo-reset').addEventListener('click', () => { loadInput(DEMO_INPUT, '演示假设'); state.selected = DEMO_INPUT.companies[1].id; state.marketData = clone(DEMO_MARKET_DATA); state.marketMode = '演示合成行情'; update(); updateMarket(); notice('已载入虚构演示', 'warning'); });
$('evidence-add').addEventListener('click', () => { $('evidence-form').reset(); $('evidence-dialog').showModal(); });
$('evidence-form').addEventListener('submit', event => { event.preventDefault(); const form = Object.fromEntries([...new FormData(event.target)].filter(([, value]) => String(value).trim()).map(([key, value]) => [key, String(value).trim()])); workflow.invalidate(); state.input.evidence.push({ id: id('evidence'), ...form }); $('evidence-dialog').close(); renderEditors(); update(); notice('来源已添加'); });
$('evidence-list').addEventListener('click', async event => { const target = event.target.closest('[data-remove-evidence]'); if (!target || !await ask({title:'删除资料来源',message:'删除此来源并解除当前企业引用？已保存情景中的原来源仍保留。'})) return; workflow.invalidate(); state.input.evidence = state.input.evidence.filter(row => row.id !== target.dataset.removeEvidence); state.input.companies.forEach(row => { row.evidenceIds = (row.evidenceIds || []).filter(value => value !== target.dataset.removeEvidence); }); renderEditors(); update(); });
$('fetch-market').addEventListener('click', fetchMarket);
$('market-demo').addEventListener('click', () => { if (modelFor(state.input).id === 'event_study') workflow.invalidate(); state.marketData = clone(DEMO_MARKET_DATA); state.marketMode = '演示合成行情'; update(); updateMarket(); notice('已载入合成行情', 'warning'); });
for (const name of ['window-before', 'window-after','market-method']) $(name).addEventListener('change', () => { if (modelFor(state.input).id === 'event_study') workflow.invalidate();state.input.analysis.marketMethod=$('market-method').value; update(); updateMarket(); });
for (const name of ['json-input', 'settings-json', 'csv-input', 'market-import']) $(name).addEventListener('change', async event => { try { await (name === 'csv-input' ? importCompanies : name === 'market-import' ? importMarket : readInputFile)(event.target.files[0]); } catch (error) { notice(`导入失败：${error.message}`, 'error'); } finally { event.target.value = ''; } });
$('json-export').addEventListener('click', exportJSON);
$('template').addEventListener('click', () => {const template=clone(DEMO_INPUT);template.analysis={model:'cost_transmission'};upgradeEntities(template,{demo:true});download(JSON.stringify(template,null,2),'量化模块_v0.4_逐对象模板_演示假设.json');});
$('csv-template').addEventListener('click', () => { const headers = ['id', 'name', 'role', 'shockChannel', ...Object.keys(fieldLabels), 'evidenceIds']; download(csvString(headers, DEMO_INPUT.companies.map(row => ({ ...row, evidenceIds: row.evidenceIds.join('|') }))), '企业基线_模板_演示假设.csv', 'text/csv;charset=utf-8'); });
$('schema-download').addEventListener('click', async () => { try { const response = await fetch('/contracts/input.schema.json'); if (!response.ok) throw new Error('规范下载失败'); download(await response.blob(), '量化输入规范.schema.json'); } catch (error) { notice(error.message, 'error'); } });
$('export-open').addEventListener('click', () => $('export-dialog').showModal()); $('export-confirm').addEventListener('click', exportReport);
renderControls(); renderSaved(); update(); renderEditors(); updateMarket(); switchView('setup');
fetch('/api/health').then(async response => { if (!response.ok) throw new Error(); const data = await response.json();state.searchConfigured=data.searchConfigured; $('server-dot').classList.add('ok'); $('server-state').textContent = '独立服务 · 在线'; if (data.tokenConfigured) $('tushare-token').placeholder = '服务端已配置 Token，可留空';update(); }).catch(() => { $('server-state').textContent = '服务不可用 · 仅本地计算'; notice('计算页面仍可使用；数据取数和 Word 导出需要启动本模块服务。', 'warning'); });
