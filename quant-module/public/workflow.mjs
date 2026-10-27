import { MODEL_CATALOG, BASELINE_FIELDS, modelFor, validateQuant } from '/src/models.mjs';
import { runEventStudy } from '/src/core.mjs';
import { installPreparation } from '/preparation.mjs';
import { installEntityWorkflow } from '/entity-workflow.mjs';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const fmt = value => Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '未填写';
const kindLabel = { user: '待核验输入', reference: '人工审核参考', assumption: '情景假设' };
function safeUrl(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } }
export function baselineSource(input, company, field) {
  const source = company.baselineSources?.[field];
  if (source) return source;
  const evidence = (input.evidence || []).find(item => company.evidenceIds?.includes(item.id));
  return { kind: evidence?.kind === 'assumption' ? 'assumption' : 'user', ...(evidence ? { evidenceId: evidence.id } : {}) };
}

export function installWorkflow({ state, update, renderEditors, renderControls, switchView, notice, updateMarket }) {
  function invalidate() {
    state.confirmed = false; state.calculated = false; state.result = null;
    if (state.input.analysis) delete state.input.analysis.baselineReview;
    if (state.input.analysis) delete state.input.analysis.eventMapping;
    $('baseline-ack').checked = false;
    $('export-download').hidden = true;
    notice('');
  }
  function fieldsForModel() { return [...new Set([...modelFor(state.input).required, 'fixedOperatingCost'])]; }
  const preparation = installPreparation({state, invalidate, update, renderEditors, switchView, notice});
  const entities = installEntityWorkflow({ state, invalidate, update, renderControls, notice });
  function issues() {
    const model = modelFor(state.input), validation = validateQuant(state.input), errors = [...validation.errors];
    if (!state.modelChosen) errors.unshift('请先选择一个量化模型。');
    if (model.id === 'event_study') {
      const market = runEventStudy({ ...state.marketData, eventDate: state.input.context.eventDate, asOf: state.input.context.asOf, before: Number($('window-before').value), after: Number($('window-after').value), expectedReturnModel: state.input.analysis.marketMethod || 'market_adjusted' });
      if (!['available', 'partial'].includes(market.status)) errors.push('事件研究尚无足够共同行情，需先获取或导入数据；至少 3 个共同收益日且包含事件日或之后。');
      return errors;
    }
    if (!state.input.companies.length) errors.push('请至少添加一家企业。');
    validation.missing.forEach(row => row.fields.forEach(field => errors.push(`${row.name}：缺少${BASELINE_FIELDS[field]?.label || field}`)));
    for (const company of state.input.companies) for (const field of fieldsForModel()) {
      if (company[field] == null) continue;
      const source = baselineSource(state.input, company, field);
      const evidence = state.input.evidence.find(row => row.id === source.evidenceId);
      if (source.kind === 'reference' && !evidence) errors.push(`${company.name}的${BASELINE_FIELDS[field].label}标为参考值，但未绑定有效来源。`);
      if (evidence?.publishedAt && evidence.publishedAt > state.input.context.asOf) errors.push(`${company.name}的${BASELINE_FIELDS[field].label}来源披露日晚于截止日，请替换或修改研究设置。`);
    }
    return [...new Set([...errors, ...preparation.pendingIssues()])];
  }
  function sourceHtml(company, field) {
    const source = baselineSource(state.input, company, field), evidence = state.input.evidence.find(row => row.id === source.evidenceId), url = safeUrl(evidence?.url);
    return `<span class="tag ${source.kind === 'assumption' ? 'warning' : 'user'}">${esc(kindLabel[source.kind] || kindLabel.user)}</span><small>${esc(evidence?.source || '未绑定来源')}${evidence?.publishedAt ? ` · ${esc(evidence.publishedAt)}` : ' · 日期未提供'}</small>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">查看来源 ↗</a>` : ''}${evidence?.locator ? `<small>${esc(evidence.locator)}</small>` : ''}`;
  }
  function render() {
    preparation.render();
    entities.render();
    const model = modelFor(state.input), errors = issues();
    $('model-cards').innerHTML = MODEL_CATALOG.map(item => `<article class="model-card ${state.modelChosen && model.id === item.id ? 'selected' : ''}"><div><span class="model-icon">${item.icon}</span>${state.modelChosen && model.id === item.id ? ' <span class="tag observed">已选择</span>' : ''}</div><h3>${esc(item.title)}</h3><p>${esc(item.shortDescription || item.question)}</p><div class="model-topic"><b>适合研究</b><span>${esc(item.topic)}</span></div><div class="action-row"><button class="button ${state.modelChosen && model.id === item.id ? 'primary' : 'secondary'}" data-select-model="${item.id}">${state.modelChosen && model.id === item.id ? '当前使用' : '选择此模型'}</button><button class="text-button" data-method-model="${item.id}">公式与假设 ↗</button></div></article>`).join('');
    $('model-selection-note').textContent = state.modelChosen ? `已选：${model.title}` : '请选择模型';
    $('model-next').disabled = !state.modelChosen;
    $('workflow-status').textContent = !state.modelChosen ? '等待选择模型' : state.calculated ? '已计算' : state.confirmed ? '基准已确认 · 等待计算' : '待确认基准';
    $('baseline-model-note').textContent = model.title;
    $('baseline-form-note').textContent = `${model.title} · ${state.input.context.periodLabel || '请先设定基线期间'} · 万元 / %`;

    $('baseline-period').innerHTML = `${model.id === 'event_study' ? `行情基准窗口：<strong>T−${$('window-before').value} 至 T+${$('window-after').value}</strong> · 事件日 ${esc(state.input.context.eventDate || '尚未设定')}` : `基线期间：<strong>${esc(state.input.context.periodLabel || '尚未设定')}</strong> · 分析期限 ${state.input.parameters.horizonMonths} 月`} · 截止日：${esc(state.input.context.asOf || '尚未设定')} <button class="text-button" data-open-settings>修改 ↗</button>`;
    $('baseline-edit').hidden = model.id === 'event_study';
    $('view-companies').querySelector('.import-bar').hidden = model.id === 'event_study';
    if (model.id === 'event_study') {
      const market = runEventStudy({ ...state.marketData, eventDate: state.input.context.eventDate, asOf: state.input.context.asOf, before: Number($('window-before').value), after: Number($('window-after').value), expectedReturnModel: state.input.analysis.marketMethod || 'market_adjusted' });
      $('baseline-readiness').innerHTML = `<div class="baseline-readiness"><span class="tag ${errors.length ? 'missing' : 'observed'}">${errors.length ? '尚有缺口' : '行情齐备'}</span><span class="tag warning">${esc(state.marketMode)}</span><button class="text-button" data-go="market">获取／导入行情 ↗</button></div>`;
      $('baseline-snapshot').innerHTML = `<table class="baseline-snapshot"><tbody><tr><th>证券样本</th><td>${state.marketData.companies.map(company => `${esc(company.name || company.id)}（${esc(company.id)}）`).join('、') || '尚未加载'}</td></tr><tr><th>基准与来源</th><td>${esc(state.marketData.provenance?.params?.benchmarkCode || state.marketData.provenance?.benchmarkCode || (state.marketData.provenance?.kind === 'assumption' ? '演示合成基准，无真实指数代码' : '导入基准，代码未注明'))}<small>${esc(state.marketData.provenance?.provider || '来源未注明')} · </small></td></tr><tr><th>预期收益方法</th><td>${esc(market.method)}</td></tr><tr><th>事件窗口</th><td>T−${$('window-before').value} 至 T+${$('window-after').value} · ${market.series.length} 个共同有效收益日</td></tr><tr><th>可用日期范围</th><td>${esc(market.window?.startDate || '无')} 至 ${esc(market.window?.endDate || '无')}<small>T0：${esc(market.tradingEventDate || '未取得')}</small></td></tr></tbody></table>`;
    } else {
      const fields = fieldsForModel();
      const count = state.input.companies.reduce((sum, company) => sum + model.required.filter(field => Number.isFinite(company[field])).length, 0), total = state.input.companies.length * model.required.length;
      $('baseline-readiness').innerHTML = `<div class="baseline-readiness"><span class="tag ${errors.length ? 'missing' : 'observed'}">必填数据 ${count} / ${total}</span></div>`;
      $('baseline-snapshot').innerHTML = `<table class="baseline-snapshot"><thead><tr><th>企业／指标</th>${fields.map(field => `<th>${esc(BASELINE_FIELDS[field].label)}<small>${BASELINE_FIELDS[field].unit} · ${model.required.includes(field) ? '必填' : '可选'}</small></th>`).join('')}</tr></thead><tbody>${state.input.companies.map(company => `<tr><td><strong>${esc(company.name)}</strong><small>${esc(state.input.context.periodLabel)}</small><small>${esc(company.scope?.product || '产品待明确')}</small></td>${fields.map(field => `<td><strong class="${company[field] == null ? 'negative' : ''}">${fmt(company[field])}</strong>${company[field] != null ? sourceHtml(company, field) : '<button class="text-button" data-go="companies">返回准备补齐 ↗</button>'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }
    $('baseline-validation').innerHTML = errors.length ? `<strong>确认前需处理：</strong><ul>${errors.map(error => `<li>${esc(error)}</li>`).join('')}</ul>` : '<span class="positive">基准齐备</span>';
    $('baseline-confirm').disabled = errors.length > 0 || !$('baseline-ack').checked;
    $('calculate').disabled = !state.confirmed;
    $('baseline-confirm-status').textContent = state.confirmed ? `已确认 · ${new Date(state.input.analysis.baselineReview.confirmedAt).toLocaleString('zh-CN')}` : '待确认';
    $('result-baseline-summary').innerHTML = `<p class="method-note">${esc(model.title)} · ${esc(state.input.context.periodLabel)} · ${state.confirmed ? '用户已确认' : '未确认，尚不可计算'}</p>`;

    document.querySelector('[data-view="overview"]').classList.toggle('active', state.view==='market'||state.view==='overview');
    renderBreakEven();
  }
  function openMethod(modelId = modelFor(state.input).id) {
    const model = MODEL_CATALOG.find(item => item.id === modelId);
    $('model-dialog-title').textContent = `${model.title} · 公式与适用条件`;
    $('model-dialog-content').innerHTML = `<section class="model-method"><p>${esc(model.question)}</p><h3>适用主题</h3><p>${esc(model.topic)}</p><h3>需要的数据</h3><p>${model.id === 'event_study' ? '事件日、截止日、证券／基准行情、复权因子、窗口长度；成交量 Z 另需前置成交量。' : model.required.map(field => `${BASELINE_FIELDS[field].label}（${BASELINE_FIELDS[field].unit}）`).join('、')}</p><h3>计算公式</h3>${model.id !== 'event_study' ? '<p>符号：R₀ 基线营业收入，g₀ 基线毛利率，b 变动成本占营业成本，F 固定经营费用，p 产品售价变化率，q 销量变化率；下标 0／1 表示基线／情景。公式中的百分数先除以 100。</p>' : ''}${model.formulas.map(formula => `<p class="formula-line">${esc(formula)}</p>`).join('')}<h3>基础假设与解释边界</h3><ul>${model.assumptions.map(assumption => `<li>${esc(assumption)}</li>`).join('')}</ul><p>所有变化量相对用户确认的同期间基准。金额是万元，毛利率差为百分点；精确计算不代表精确预测。</p></section>`;
    $('model-dialog').showModal();
  }
  function calculate() {
    const errors = issues();
    if (!state.confirmed || errors.length) { notice('先选择模型、补齐必要数据并确认基准，再开始计算。', 'warning'); switchView('review'); return; }
    state.calculated = true; update(); updateMarket();
    switchView(modelFor(state.input).id === 'event_study' ? 'market' : 'overview');
    notice('');
  }
  function renderBreakEven() {
    const row = state.result?.companies.find(company => company.id === state.selected) || state.result?.companies[0];
    const visible = modelFor(state.input).id === 'break_even' && row?.status === 'estimated';
    $('break-even-card').hidden = !visible; if (!visible) return;
    const point = row.breakEven;
    $('break-even-metrics').innerHTML = [['盈亏平衡收入', point.revenue, '万元'], ['达到盈亏平衡所需销量变化', point.requiredVolumeChangePct, '%'], ['当前情景安全边际', point.safetyMarginPct, '%']].map(([label, value, unit]) => `<div class="metric"><span>${label}</span><strong>${value == null ? label === '当前情景安全边际' ? '不适用' : '无有限正向门槛' : `${fmt(value)}<small>${unit}</small>`}</strong></div>`).join('');
    const currentIndex = 1 + row.parameters.volumePct / 100, max = Math.min(5, Math.max(2, currentIndex * 1.2, (point.volumeIndex || 0) * 1.2));
    const revenueAt = index => row.baseline.revenue * (1 + row.scenario.priceChangePct / 100) * index;
    const costAt = index => point.variableCost * index + point.fixedCost;
    const ymax = Math.max(1, revenueAt(max), costAt(max)), x = index => 65 + index / max * 640, y = value => 245 - value / ymax * 205;
    let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 320" role="img" aria-label="收入与总成本的盈亏平衡曲线" style="font-family:Microsoft YaHei,Arial,sans-serif;background:#fff"><title>基线销量指数与经营盈亏平衡</title>';
    for (let i = 0; i <= 4; i++) { const value = ymax * i / 4; svg += `<line x1="65" x2="705" y1="${y(value)}" y2="${y(value)}" stroke="#e7eef1"/><text x="58" y="${y(value) + 4}" text-anchor="end" font-size="10" fill="#71828c">${fmt(value)}</text>`; }
    svg += `<line x1="65" x2="705" y1="${y(0)}" y2="${y(revenueAt(max))}" stroke="#159b80" stroke-width="3"/><line x1="65" x2="705" y1="${y(costAt(0))}" y2="${y(costAt(max))}" stroke="#d87157" stroke-width="3"/>`;
    if (point.volumeIndex != null && point.volumeIndex <= max) svg += `<circle cx="${x(point.volumeIndex)}" cy="${y(revenueAt(point.volumeIndex))}" r="6" fill="#153b4b"><title>盈亏平衡：基线销量 ${fmt(point.volumeIndex)} 倍，收入 ${fmt(point.revenue)} 万元</title></circle>`;
    svg += `<line x1="${x(currentIndex)}" x2="${x(currentIndex)}" y1="30" y2="245" stroke="#9c6a20" stroke-dasharray="5 4"/><text x="${x(currentIndex)}" y="22" text-anchor="middle" font-size="11" fill="#9c6a20">当前销量 ${fmt(currentIndex)} 倍</text>`;
    for (let i = 0; i <= 4; i++) svg += `<text x="${x(max * i / 4)}" y="265" text-anchor="middle" fill="#71828c" font-size="11">${fmt(max * i / 4)}×</text>`;
    $('break-even-chart').innerHTML = `${svg}<text x="65" y="291" font-size="12" fill="#159b80">绿色：收入</text><text x="195" y="291" font-size="12" fill="#d87157">橙色：总经营成本</text><text x="65" y="312" font-size="10" fill="#71828c">纵轴万元；横轴为基线销量倍数，显示范围最多 5 倍。${point.volumeIndex > max ? '盈亏平衡点在图外。' : point.volumeIndex == null ? '贡献毛益非正，不存在有限正向盈亏平衡点。' : ''}</text></svg>`;
  }
  document.addEventListener('click', event => {
    const select = event.target.closest('[data-select-model]'), method = event.target.closest('[data-method-model]'), go = event.target.closest('[data-go]');
    if (select) {
      const previousModel = modelFor(state.input).id;
      invalidate(); state.input.analysis = { ...state.input.analysis, model: select.dataset.selectModel };
      if (previousModel !== select.dataset.selectModel && (previousModel === 'cost_transmission' || select.dataset.selectModel === 'cost_transmission')) {
        for (const c of state.input.companies) { c.scenario.costPct = 0; c.scope.costItem = ''; }
      }
      for (const c of state.input.companies) if (select.dataset.selectModel !== 'cost_transmission') { c.scenario.passThroughPct = 0; c.scenario.lagMonths = 0; }
      state.modelChosen = true; renderControls(); renderEditors(); update(); updateMarket();
      if (previousModel !== select.dataset.selectModel) notice('模型已切换，请重新确认基准与参数。','warning');
    }
    if (method) openMethod(method.dataset.methodModel);
    if (go) switchView(go.dataset.go);
    if (event.target.closest('[data-open-model]')) openMethod();
    if (event.target.closest('[data-open-settings]')) $('settings-open').click();
  });
  $('model-docs').addEventListener('click', () => openMethod());
  $('model-next').addEventListener('click', () => { switchView('companies'); });
  $('baseline-edit').addEventListener('click', () => { if (!state.modelChosen) { notice('请先选择模型。', 'warning'); switchView('setup'); return; } renderEditors(); $('baseline-dialog').showModal(); });
  $('baseline-edit-done').addEventListener('click', () => { $('baseline-dialog').close(); switchView('companies'); render(); });
  $('baseline-add-source').addEventListener('click', () => $('evidence-add').click());
  $('baseline-ack').addEventListener('change', render);
  $('baseline-confirm').addEventListener('click', () => {
    if (issues().length || !$('baseline-ack').checked) return;
    if (modelFor(state.input).id !== 'event_study') preparation.prepareAssumptions();
    const fields = modelFor(state.input).id === 'event_study' ? [] : state.input.companies.flatMap(company => fieldsForModel().filter(field => company[field] != null).map(field => ({ companyId: company.id, field, value: company[field], ...baselineSource(state.input, company, field) })));
    state.input.analysis.eventMapping = { description: state.input.context.eventDescription, eventDate: state.input.context.eventDate, modelId: modelFor(state.input).id, reviewedAt: new Date().toISOString() };
    state.input.analysis.baselineReview = { confirmedAt: new Date().toISOString(), periodLabel: state.input.context.periodLabel, fields, ...(modelFor(state.input).id !== 'event_study' ? { scopes: state.input.companies.map(c => ({ id:c.id, scope:structuredClone(c.scope) })) } : {}) };
    state.confirmed = true; update(); notice('基准已确认');
  });
  $('calculate').addEventListener('click', calculate); $('workflow-calculate').addEventListener('click', calculate);
  return { render, invalidate, openMethod, calculate, resetPreparation:preparation.reset, preparation };
}
