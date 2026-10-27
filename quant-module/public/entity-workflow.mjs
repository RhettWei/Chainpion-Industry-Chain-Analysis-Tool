import { ENTITY_PARAMS, entityParams, neutralScenario, parseEvent } from '/src/scenarios.mjs';
import { modelFor } from '/src/models.mjs';
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export function scenarioText(c, modelId) {
  if (!c.scenario) return '旧版统一参数，请重新确认范围';
  if (!c.scenario.affected) return `${c.scope?.product || '产品待明确'} · 未受影响，维持基线`;
  const s = c.scenario, labels = entityParams(modelId).filter(k => s[k] !== 0).map(k => `${k === 'costPct' ? `${modelId === 'cost_transmission' ? c.scope?.costItem || '指定成本项' : '单位变动成本'}单价` : ENTITY_PARAMS[k].label} ${s[k] > 0 ? '+' : ''}${s[k]}${ENTITY_PARAMS[k].unit}`);
  return `${c.scope?.product || '产品待明确'} · ${labels.join('；') || '全部变化为0'}`;
}
export function installEntityWorkflow({ state, invalidate, update, renderControls, notice }) {
  function render() {
    const model = modelFor(state.input), market = model.id === 'event_study', draft = parseEvent(state.input.context.eventDescription);
    $('event-mapping').hidden = market;
    $('event-review').textContent = market ? `市场事件：${state.input.context.eventDescription || '待填写'} · ${state.input.context.eventDate}` : `研究事件：${state.input.context.eventDescription || '待填写'}\n${state.input.companies.map(c => `${c.name}：${scenarioText(c, model.id)}`).join('\n')}`;
    if (market) return;
    // Keep the review snapshot current without replacing the focused editor.
    if (state.entityEditing) return;
    const candidate = draft.status === 'candidate';
    $('event-mapping').innerHTML = `<div class="event-definition"><span class="eyebrow">EVENT → OBJECT → PARAMETERS</span><h2>事件与作用对象</h2><p>研究事件：<strong>${esc(state.input.context.eventDescription || '请先填写研究设置')}</strong></p><div class="event-draft ${candidate ? '' : 'pending'}"><strong>${candidate ? `文字候选：${esc(draft.key === 'costPct' && model.id !== 'cost_transmission' ? '该业务单位变动成本变化' : ENTITY_PARAMS[draft.key].label)} ${draft.value > 0 ? '+' : ''}${draft.value}%` : '需要手动定义情景'}</strong>${candidate ? `<div class="action-row"><label>只应用到这个对象<select id="draft-company"><option value="">请选择对象</option>${state.input.companies.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label><button class="button secondary" id="adopt-event">采用为该对象的假设</button></div>` : ''}</div></div><div class="entity-grid">${state.input.companies.map(c => `<article class="entity-card" data-entity="${esc(c.id)}"><div class="card-title"><h3>${esc(c.name)}</h3><label class="check-label"><input type="checkbox" data-scenario="affected" ${c.scenario?.affected ? 'checked' : ''}>受事件影响</label></div><div class="form-grid"><label>测算范围<select data-scope="level">${[['company','公司整体'],['segment','业务分部'],['product','具体产品']].map(([v,t]) => `<option value="${v}" ${c.scope?.level === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label>产品 / 业务（必填）<input data-scope="product" value="${esc(c.scope?.product)}" placeholder="例如：灵巧手产品业务"></label><label>具体受影响成本项<input data-scope="costItem" value="${esc(c.scope?.costItem)}" placeholder="例如：电机采购／该产品单位变动成本"></label><label>产品计价口径<input data-scope="unit" value="${esc(c.scope?.unit)}" placeholder="元 / 只"></label></div><div class="entity-param-grid">${entityParams(model.id).map(k => { const spec = ENTITY_PARAMS[k]; return `<label>${k === 'costPct' && model.id !== 'cost_transmission' ? '该业务单位变动成本变化' : spec.label}（${spec.unit}）<input type="number" data-scenario="${k}" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${c.scenario?.[k] ?? 0}" ${c.scenario?.affected ? '' : 'disabled'}></label>`; }).join('')}</div></article>`).join('')}</div>`;
  }
  function editEntity(event) {
    const card = event.target.closest('[data-entity]'); if (!card) return;
    const c = state.input.companies.find(c => c.id === card.dataset.entity); invalidate();
    if (event.target.dataset.scope) c.scope[event.target.dataset.scope] = event.target.value.trim();
    if (event.target.dataset.scenario) {
      const key = event.target.dataset.scenario;
      if (key === 'affected') c.scenario = event.target.checked ? { ...neutralScenario(), affected: true } : neutralScenario();
      else c.scenario[key] = event.target.value === '' ? null : Number(event.target.value);
    }
    renderControls(); state.entityEditing = event.type === 'input'; update(); state.entityEditing = false;
  }
  $('event-mapping').addEventListener('input', editEntity);
  $('event-mapping').addEventListener('change', editEntity);
  $('event-mapping').addEventListener('click', event => {
    if (!event.target.closest('#adopt-event')) return;
    const draft = parseEvent(state.input.context.eventDescription), c = state.input.companies.find(c => c.id === $('draft-company').value);
    if (!c || draft.status !== 'candidate') { notice('请选择作用对象。','warning'); return; }
    invalidate(); c.scenario.affected = true; c.scenario[draft.key] = draft.value; renderControls(); update(); notice(`${c.name}：已采用 ${draft.value}%`);
  });
  return { render };
}
