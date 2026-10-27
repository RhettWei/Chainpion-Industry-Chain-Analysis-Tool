import { BASELINE_FIELDS, modelFor, validateQuant } from '/src/models.mjs';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const labels = { assumption:'情景假设', materials:'从资料提取', online:'联网补齐' };
const num = value => Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits:4 }) : '待审核／补充';
const multiplier = unit => ({'元':.0001,'千元':.1,'万元':1,'百万元':100,'千万元':1000,'亿元':10000,'比例（0～1）':100,'%':1}[unit] ?? NaN);
const keyFor = (companyId, field) => `${companyId}:${field}`;
export function acquisitionRoute(state, company, field) { return state.acquisition?.routes[keyFor(company.id, field)] || company.baselineSources?.[field]?.route || (company.baselineSources?.[field]?.kind === 'reference' ? 'materials' : 'assumption'); }
function safeUrl(value) { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; } }

export function installPreparation({ state, invalidate, update, renderEditors, switchView, notice }) {
  state.acquisition = { routes:{}, materials:[], candidates:[], messages:[], bindings:{}, adoptedMaterials:{}, codes:{}, periodEnd:'', busy:false };
  const data = () => state.acquisition;
  let scope = '', basisScope = '', controller = null, revision = 0, selectedCandidate = null;
  const fields = () => [...new Set([...modelFor(state.input).required, 'fixedOperatingCost'])];
  const basisKey = () => JSON.stringify([state.input.context, state.input.companies.map(c => [c.id, c.name, c.scope])]);
  const contextKey = () => JSON.stringify([basisKey(), modelFor(state.input).id]);
  const fingerprint = (company, field) => JSON.stringify([contextKey(), company.id, field, acquisitionRoute(state, company, field), data().bindings[company.id] || '*', data().materials.map(m => m.id), acquisitionRoute(state,company,field)==='online'?[data().codes[company.id] || company.id,data().periodEnd]:null]);
  const currentCandidate = item => { const c = state.input.companies.find(c => c.id === item.companyId); return c && fields().includes(item.field) && item.fingerprint === fingerprint(c, item.field); };
  function cancel() { revision++; controller?.abort(); controller = null; data().busy = false; }
  function reset() { cancel(); state.acquisition = { routes:{}, materials:[], candidates:[], messages:[], bindings:{}, adoptedMaterials:{}, codes:{}, periodEnd:'', busy:false }; scope = ''; basisScope = ''; }
  function clearReference(company, field) { const route=acquisitionRoute(state,company,field);if(route==='assumption')return;data().routes[keyFor(company.id,field)]=route;company[field]=null;delete company.baselineSources?.[field];delete data().adoptedMaterials[keyFor(company.id,field)]; }
  function clearOnline(companyId) { cancel();invalidate();for(const company of state.input.companies)if(!companyId||company.id===companyId)for(const field of Object.keys(BASELINE_FIELDS))if(acquisitionRoute(state,company,field)==='online')clearReference(company,field);data().candidates=data().candidates.filter(c=>c.route!=='online'||(companyId&&c.companyId!==companyId)); }
  function changeRoute(companyId, field, route) {
    const company = state.input.companies.find(c => c.id === companyId); if (!company || !labels[route]) return;
    if (acquisitionRoute(state, company, field) === route) return;
    cancel(); invalidate(); data().routes[keyFor(companyId, field)] = route;
    delete data().adoptedMaterials[keyFor(companyId,field)];
    if (route !== 'assumption') company[field] = null;
    company.baselineSources ||= {};
    delete company.baselineSources[field];
    if (route === 'assumption') company.baselineSources[field] = { kind:'assumption', route:'assumption' };
    data().candidates = data().candidates.filter(item => !(item.companyId === companyId && item.field === field));
    renderEditors(); update();
  }
  function pendingIssues() {
    if (modelFor(state.input).id === 'event_study') return [];
    return state.input.companies.flatMap(c => fields().filter(f => {
      const route = acquisitionRoute(state, c, f), source = c.baselineSources?.[f];
      return route !== 'assumption' && (modelFor(state.input).required.includes(f) || c[f] != null) && (!source?.review || source.review.period !== state.input.context.periodLabel || source.route !== route);
    }).map(f => `${c.name}：${BASELINE_FIELDS[f].label}需审核${labels[acquisitionRoute(state,c,f)]}的候选，或改为情景假设。`));
  }
  function prepareAssumptions() {
    for (const company of state.input.companies) for (const field of fields()) if (acquisitionRoute(state,company,field) === 'assumption' && company[field] != null) {
      const previous = company.baselineSources?.[field] || {kind:'assumption',evidenceId:state.input.evidence.find(e=>e.kind==='assumption'&&company.evidenceIds?.includes(e.id))?.id}; company.baselineSources ||= {};
      company.baselineSources[field] = { kind:'assumption', route:'assumption', ...(previous?.kind === 'assumption' && previous.evidenceId ? { evidenceId:previous.evidenceId } : {}) };
    }
  }
  function render() {
    if(basisScope && basisScope!==basisKey()) { invalidate(); for(const company of state.input.companies) for(const field of Object.keys(BASELINE_FIELDS)) if(company.baselineSources?.[field]?.kind==='reference') clearReference(company,field); }
    basisScope=basisKey();
    if (scope && scope !== contextKey()) { cancel(); data().candidates = []; data().messages = ['研究设置已变更，请重新审核资料。']; }
    scope = contextKey();
    const model = modelFor(state.input), financial = model.id !== 'event_study';
    if (!financial) {
      $('preparation-content').innerHTML = `<div class="route-explainer"><h3>证券与指数行情</h3><button class="button primary" data-go="market">准备证券与指数行情 →</button> <button class="button secondary" data-go="review">核对行情基准 →</button></div>`;
      $('candidate-summary').textContent = '行情基准'; $('candidate-list').replaceChildren(); return;
    }
    const pending = data().candidates.filter(c => currentCandidate(c) && c.status === 'pending');
    $('preparation-content').innerHTML = `<div class="prep-section"><div class="card-title"><div><h3>本轮参考资料</h3></div><button id="material-add" class="button secondary">＋ 上传／粘贴资料</button></div><div class="material-list">${data().materials.map(m=>`<div><strong>${esc(m.name)}</strong><small>${m.publishedAt ? '披露 '+esc(m.publishedAt) : '披露日期待补充'} · 仅本轮</small><button class="text-button danger" data-material-remove="${m.id}">移除</button></div>`).join('') || '<p class="method-note">暂无资料</p>'}</div></div>${state.input.companies.map(company=>`<article class="prep-company"><div class="card-title"><div><h3>${esc(company.name)}</h3><p>${esc(state.input.context.periodLabel)} · 金额万元／比例百分数</p></div><button class="text-button" data-edit-company>编辑企业 ↗</button></div><div class="prep-field-grid">${fields().map(field=>{
      const route = acquisitionRoute(state,company,field), approved = company.baselineSources?.[field]?.review?.period === state.input.context.periodLabel;
      return `<div class="prep-field"><label title="${esc(BASELINE_FIELDS[field].note)}">${esc(BASELINE_FIELDS[field].label)} <small>${model.required.includes(field) ? '必填' : '可选'}</small><select data-route="${field}" data-company="${esc(company.id)}">${Object.entries(labels).map(([r,l])=>`<option value="${r}" ${route===r?'selected':''}>${l}</option>`).join('')}</select></label>${route==='assumption' ? `<label>假设值（${BASELINE_FIELDS[field].unit}）<input type="number" step="any" data-assumption="${field}" data-company="${esc(company.id)}" value="${company[field] ?? ''}" placeholder="数值"></label>` : `<div class="prep-value ${approved ? 'positive':''}">${num(company[field])} ${esc(BASELINE_FIELDS[field].unit)}<small>${approved ? '已审核' : route==='materials'?'待提取':'待查找'}</small></div>`}</div>`;
    }).join('')}</div><div class="company-acquisition-meta"><label>资料范围<select data-bind-company="${esc(company.id)}"><option value="">全部资料</option>${data().materials.map(m=>`<option value="${m.id}" ${data().bindings[company.id]===m.id?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label><label>财报证券代码（仅公司合并范围）<input data-code-company="${esc(company.id)}" value="${esc(data().codes[company.id] || (/^\d{6}\.(SH|SZ|BJ)$/.test(company.id)?company.id:''))}" placeholder="300750.SZ"></label></div></article>`).join('')}<details class="credentials" id="batch-credentials"><summary>数据接口设置</summary><p class="search-status">网页搜索：${state.searchConfigured ? "Brave 已配置" : "未配置 Brave Key"}</p><div class="form-grid"><label>财报期末（季末／年末）<input id="batch-period" type="date" value="${esc(data().periodEnd)}"></label><label>临时 Tushare Token<input id="batch-token" type="password" autocomplete="off" placeholder="服务端已配置时留空"></label></div><label>临时 Brave Search API Key<input id="batch-search-key" type="password" autocomplete="off" placeholder="Brave Search Key"></label><a href="https://api-dashboard.search.brave.com/" target="_blank" rel="noopener noreferrer">申请搜索 Key ↗</a><label class="check-label"><input id="batch-primary" type="checkbox" checked>优先官方公告、交易所和政府来源</label></details><div class="action-row"><button id="resolve-baselines" class="button primary" ${data().busy || !state.modelChosen?'disabled':''}>${data().busy?'查找中…':'提取 / 查找数据'}</button><button id="cancel-baselines" class="button secondary" ${data().busy?'':'hidden'}>停止查找</button><button class="button secondary" data-go="review">审核候选（${pending.length}） →</button></div><div id="batch-progress" role="status" class="progress-note">${esc(data().progress || '')}</div><div class="prep-messages">${data().messages.map(m=>`<p>${esc(m)}</p>`).join('')}</div>`;
    $('candidate-summary').textContent = `${pending.length}条候选待审 · ${data().candidates.filter(c=>currentCandidate(c)&&c.status==='approved').length}条已采用`;
    $('candidate-list').innerHTML = data().candidates.filter(currentCandidate).map(c=>`<article class="candidate-card"><div class="badge-row"><span class="tag ${c.status==='approved'?'observed':c.status==='rejected'?'subtle':'warning'}">${c.status==='approved'?'已人工采用':c.status==='rejected'?'已拒绝':'待审核'}</span><span class="tag user">${esc(labels[c.route])}</span></div><h3>${esc(c.companyName)} · ${esc(BASELINE_FIELDS[c.field].label)}</h3><strong class="reference-value">${Number.isFinite(c.value)?`${num(c.value)} ${esc(c.unit || '单位待确认')}`:'未取得可靠数值，需阅读原文'}</strong><p>${esc(c.title || c.source)}</p><blockquote>${esc(c.description || '没有摘要，请查看原始资料。')}</blockquote><small>${esc(c.period || '数据期间待核对')} · ${esc(c.publishedAt || '披露日期待补充')} · ${esc(c.locator || '定位待补充')}</small>${c.companyMatched===false?'<p class="negative">原文未匹配企业名：不可直接当作该公司数据。</p>':''}<div class="action-row">${safeUrl(c.url)?`<a href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener noreferrer">打开原始来源 ↗</a>`:''}<button class="button secondary" data-audit="${c.id}" ${c.status==='pending'?'':'disabled'}>核对／修正并采用</button><button class="text-button danger" data-reject="${c.id}" ${c.status==='pending'?'':'disabled'}>拒绝此候选</button></div></article>`).join('') || '<div class="empty">暂无候选</div>';
  }
  async function addMaterial(event) {
    event.preventDefault(); const form = event.target, values = new FormData(form), file = $('material-file').files[0];
    const error = message => { $('material-error').textContent=message;$('material-error').hidden=false; };
    let material = { id:crypto.randomUUID(), name:String(values.get('name')).trim(), publishedAt:String(values.get('publishedAt') || ''), text:String(values.get('text') || '').trim() };
    if (material.publishedAt && material.publishedAt > state.input.context.asOf) { error('资料披露日晚于研究截止日，不能作为当时已知基准。'); return; }
    if (file) { if (file.size>3*1024*1024) { error('资料文件需在3MB以内。'); return; } const bytes=new Uint8Array(await file.arrayBuffer()); let binary=''; for(let offset=0;offset<bytes.length;offset+=8192) binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192)); material={...material,name:file.name,base64:btoa(binary)}; delete material.text; }
    if ((!material.text && !material.base64) || material.text?.length>100000) { error('请上传资料或粘贴10万字以内的原文。'); return; }
    if (data().materials.length>=10) { error('本轮最多10份资料，请先移除无用资料。'); return; }
    cancel(); invalidate(); data().materials.push(material); data().candidates=data().candidates.filter(c=>c.status==='approved'); $('material-dialog').close(); form.reset(); update(); notice('资料已加入');
  }
  async function resolve() {
    if (data().busy || !state.modelChosen) return;
    const token=$('batch-token').value.trim(), searchKey=$('batch-search-key').value.trim(), primaryOnly=$('batch-primary').checked;
    data().periodEnd=$('batch-period').value; $('batch-token').value=''; $('batch-search-key').value='';
    const tasks=[];
    for(const company of state.input.companies) {
      const materialFields=fields().filter(f=>acquisitionRoute(state,company,f)==='materials' && company.baselineSources?.[f]?.review?.period!==state.input.context.periodLabel);
      const selected=data().materials.filter(m=>!data().bindings[company.id] || m.id===data().bindings[company.id]);
      for(const material of selected) if(materialFields.length) tasks.push({type:'materials',company,fields:materialFields,material});
      for(const field of fields()) if(acquisitionRoute(state,company,field)==='online' && company.baselineSources?.[field]?.review?.period!==state.input.context.periodLabel) tasks.push({type:'online',company,fields:[field]});
    }
    data().messages=[];
    if(state.input.companies.some(c=>fields().some(f=>acquisitionRoute(state,c,f)==='materials'))&&!data().materials.length) data().messages.push('资料路径尚未上传原文：先上传／粘贴资料，再提取。');
    if(!tasks.length) { update(); notice('没有待查任务。已填写情景假设可直接去审核页；资料路径请先上传原文。','warning'); return; }
    if(tasks.length>40) { notice('本轮待查任务超过40项，请减少企业或资料数量。','warning'); return; }
    cancel(); const run=revision; controller=new AbortController(); const signal=controller.signal; data().busy=true;
    data().candidates=data().candidates.filter(c=>c.status==='approved'); update();
    for(let i=0;i<tasks.length;i++) {
      if(signal.aborted || run!==revision) break;
      const task=tasks[i], fingerprints=Object.fromEntries(task.fields.map(f=>[f,fingerprint(task.company,f)]));
      data().progress=`正在准备 ${i+1}/${tasks.length}：${task.company.name} · ${task.type==='materials'?task.material.name:BASELINE_FIELDS[task.fields[0]].label}`; $('batch-progress').textContent=data().progress;
      try {
        const body=task.type==='materials'?{name:task.material.name,...(task.material.base64?{base64:task.material.base64}:{text:task.material.text}),companyName:task.company.name,fields:task.fields,asOf:state.input.context.asOf,periodLabel:state.input.context.periodLabel,...(task.material.publishedAt?{publishedAt:task.material.publishedAt}:{})}:{scope:task.company.scope,companyName:task.company.name,industry:state.input.context.industry,field:task.fields[0],asOf:state.input.context.asOf,code:data().codes[task.company.id] || (/^\d{6}\.(SH|SZ|BJ)$/.test(task.company.id)?task.company.id:''),periodEnd:data().periodEnd,token,searchKey,primaryOnly};
        const response=await fetch(task.type==='materials'?'/api/material-extract':'/api/baseline-references',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(task.type==='materials'?25000:65000)])});
        const result=await response.json(); if(!response.ok) throw new Error(result.error || '查询未完成');
        state.usage.requests+=result.usage?.requests || 0;
        if(run!==revision || signal.aborted) break;
        const found=(result.candidates || []).filter(c=>task.fields.includes(c.field));
        for(const c of found) data().candidates.push({...c,id:crypto.randomUUID(),companyId:task.company.id,companyName:task.company.name,route:task.type,materialId:task.material?.id,status:'pending',fingerprint:fingerprints[c.field]});
        data().messages.push(`${task.company.name} · ${task.type==='materials'?task.material.name:BASELINE_FIELDS[task.fields[0]].label}：${found.length}条候选。${(result.warnings || []).join(' ')}`);
        for(const link of result.manualLinks || []) if(!found.length && safeUrl(link.url)) data().candidates.push({id:crypto.randomUUID(),field:task.fields[0],companyId:task.company.id,companyName:task.company.name,route:task.type,status:'pending',fingerprint:fingerprints[task.fields[0]],title:'人工检索入口（不是已找到的证据）',source:'人工检索入口',url:link.url,description:'尚未取得可用候选。此链接只是检索入口；采用时必须替换为实际原文链接，并填入原文数据。',manual:true});
      } catch(error) { if(signal.aborted || run!==revision) break; data().messages.push(`${task.company.name}：${error.name==='TimeoutError'?'查询超时':error.message}。未修改原有基准。`); }
    }
    if(run===revision) { data().busy=false; controller=null; data().progress=`本轮完成 · ${data().candidates.filter(c=>c.status==='pending').length}条候选待审核`; update(); notice('候选已准备'); }
  }
  function openCandidate(id) {
    const c=data().candidates.find(c=>c.id===id); if(!c||!currentCandidate(c)||c.status!=='pending') return;
    selectedCandidate=c; const field=BASELINE_FIELDS[c.field];
    $('candidate-form-content').innerHTML=`<form id="candidate-adopt"><h3>${esc(c.companyName)} · ${esc(field.label)}</h3><blockquote>${esc(c.description)}</blockquote><p>${esc(c.source)} · ${esc(c.locator || '定位待补充')}</p>${safeUrl(c.url)?`<a href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener noreferrer">打开来源，先核对原文 ↗</a>`:''}<div class="form-grid"><label>原文数值<input name="value" type="number" step="any" required value="${c.value ?? ''}"></label><label>原始单位<select name="unit" required><option value="">请核对单位</option>${(field.unit==='%'?['%','比例（0～1）']:['万元','元','千元','百万元','千万元','亿元']).map(unit=>`<option ${c.unit===unit?'selected':''}>${unit}</option>`).join('')}</select></label><label>资料数据期间／业务范围<input name="period" required value="${esc(c.period || '')}" placeholder="例如2025年全年，合并范围"></label><label>原文披露日期<input name="publishedAt" type="date" required value="${esc(c.publishedAt || '')}"></label></div><label>原始资料链接${c.route==='online'?'（必填，不能是检索入口）':'（可选）'}<input name="url" type="url" ${c.route==='online'?'required':''} value="${esc(c.manual?'':c.url || '')}" placeholder="https://原文页面"></label><label>页码／段落、口径或修正说明<input name="locator" required value="${esc(c.manual?'':c.locator || '')}"></label><label>原文摘录<textarea name="excerpt" rows="3" required>${esc(c.manual?'':c.description || '')}</textarea></label><div id="candidate-conversion" class="baseline-callout"></div><label class="check-label"><input name="ack" type="checkbox" required>已核对企业、原文、单位及期间</label><div id="candidate-error" role="alert" class="notice error" hidden></div><button class="button primary full-width" type="submit">审核通过，采用到基准</button></form>`;
    $('candidate-adopt').addEventListener('input',previewConversion); previewConversion(); $('candidate-dialog').showModal();
  }
  function converted(form) { const rawText=form.elements.value.value,raw=rawText===''?NaN:Number(rawText); return raw*multiplier(form.elements.unit.value); }
  function previewConversion() { const form=$('candidate-adopt'); if(!form) return; $('candidate-conversion').textContent=`采用值：${num(converted(form))} ${BASELINE_FIELDS[selectedCandidate.field].unit}`; }
  function adopt(event) {
    if(event.target.id!=='candidate-adopt') return; event.preventDefault(); const c=selectedCandidate, form=event.target,fd=new FormData(form);
    const error = message => { $('candidate-error').textContent=message;$('candidate-error').hidden=false; };
    if(!c||!currentCandidate(c)) { notice('候选所属模型／企业／日期／资料已变，请重新查找。','warning'); $('candidate-dialog').close(); return; }
    const company=state.input.companies.find(co=>co.id===c.companyId),value=converted(form),publishedAt=String(fd.get('publishedAt')),locator=String(fd.get('locator')).trim(),url=safeUrl(fd.get('url'));
    if(!Number.isFinite(value)||!fd.get('ack')||!fd.get('unit')||!locator||!publishedAt||publishedAt>state.input.context.asOf) { error('请补齐单位、披露日期和采用依据；披露日不能晚于研究截止日。'); return; }
    if(c.route==='online' && (!url || /\/search\?|api-dashboard\.search\.brave\.com/.test(url))) { error('联网候选必须填写实际资料的原文链接，不能只引用搜索入口。'); return; }
    if(Number.isFinite(c.value) && Number.isFinite(multiplier(c.unit)) && Math.abs(value-c.value*multiplier(c.unit))>1e-8 && locator===c.locator) { error('你修正了候选数值，请补充修正依据；原候选仍会留在摘录中。'); return; }
    const proposed=structuredClone(state.input); delete proposed.analysis.baselineReview; for(const co of proposed.companies) delete co.baselineSources; proposed.companies.find(co=>co.id===c.companyId)[c.field]=value;
    const errors=validateQuant(proposed).errors; if(errors.length) { error(`无法采用：${errors[0]}`); return; }
    invalidate(); const evidenceId=`reference-${crypto.randomUUID()}`;
    state.input.evidence.push({id:evidenceId,kind:'user',title:`${c.companyName} · ${BASELINE_FIELDS[c.field].label}`,source:c.manual&&url?new URL(url).hostname:c.source || c.title || '用户参考资料',publishedAt,...(url?{url}:{}),description:`采用值的原文摘录：${String(fd.get('excerpt')).trim()}；检索候选摘录：${c.description || ''}；原候选：${c.value ?? '未识别数值'} ${c.unit || '未识别单位'}`,locator:`${locator}；原文期间／范围：${fd.get('period')}；原文值 ${fd.get('value')} ${fd.get('unit')} → 采用 ${value} ${BASELINE_FIELDS[c.field].unit}；人工审核，不代表系统独立核验`});
    company[c.field]=value; company.baselineSources ||= {}; company.baselineSources[c.field]={kind:'reference',route:c.route,evidenceId,review:{status:'approved',reviewedAt:new Date().toISOString(),period:state.input.context.periodLabel}};
    if(c.materialId) data().adoptedMaterials[keyFor(company.id,c.field)] = c.materialId;
    company.evidenceIds=[...new Set([...(company.evidenceIds || []),evidenceId])];
    for(const item of data().candidates) if(item.companyId===c.companyId&&item.field===c.field) item.status=item.id===c.id?'approved':'rejected';
    state.mode='用户基准 / 含人工审核参考'; $('candidate-dialog').close(); renderEditors(); update(); notice('已采用候选');
  }
  document.addEventListener('click',event=>{
    if(event.target.closest('#material-add')) { $('material-form').reset(); $('material-error').hidden=true; $('material-dialog').showModal(); }
    if(event.target.closest('[data-edit-company]')) $('baseline-edit').click();
    if(event.target.closest('#resolve-baselines')) resolve();
    if(event.target.closest('#cancel-baselines')) { cancel(); data().progress='已停止查找；已返回候选保留，未返回结果不会写入。'; update(); }
    const audit=event.target.closest('[data-audit]'); if(audit) openCandidate(audit.dataset.audit);
    const reject=event.target.closest('[data-reject]'); if(reject) { const c=data().candidates.find(c=>c.id===reject.dataset.reject); if(c)c.status='rejected'; update(); }
    const remove=event.target.closest('[data-material-remove]'); if(remove) { cancel(); invalidate(); for(const co of state.input.companies) { if(data().bindings[co.id]===remove.dataset.materialRemove) delete data().bindings[co.id];for(const field of Object.keys(BASELINE_FIELDS)) if(data().adoptedMaterials[keyFor(co.id,field)]===remove.dataset.materialRemove){co[field]=null;delete co.baselineSources?.[field];delete data().adoptedMaterials[keyFor(co.id,field)];} } data().materials=data().materials.filter(m=>m.id!==remove.dataset.materialRemove); data().candidates=[]; update(); notice('资料已移除，相关采用值已清空；来源摘录保留。'); }
  });
  $('preparation-content').addEventListener('change',event=>{
    const target=event.target;
    if(target.dataset.route) changeRoute(target.dataset.company,target.dataset.route,target.value);
    if(target.dataset.assumption) {const co=state.input.companies.find(c=>c.id===target.dataset.company);invalidate();co[target.dataset.assumption]=target.value===''?null:Number(target.value);co.baselineSources ||= {};co.baselineSources[target.dataset.assumption]={kind:'assumption',route:'assumption'};state.mode='用户输入 / 含情景假设';renderEditors();update();}
    if(target.dataset.bindCompany) {cancel();invalidate();data().bindings[target.dataset.bindCompany]=target.value;const co=state.input.companies.find(c=>c.id===target.dataset.bindCompany);for(const field of fields())if(acquisitionRoute(state,co,field)==='materials'){co[field]=null;delete co.baselineSources?.[field];delete data().adoptedMaterials[keyFor(co.id,field)];}data().candidates=data().candidates.filter(c=>c.companyId!==target.dataset.bindCompany);update();}
    if(target.dataset.codeCompany) {data().codes[target.dataset.codeCompany]=target.value.trim();clearOnline(target.dataset.codeCompany);update();}
    if(target.id==='batch-period') {data().periodEnd=target.value;clearOnline();update();}
  });
  $('material-form').addEventListener('submit',event=>addMaterial(event).catch(error=>{$('material-error').textContent=`资料添加失败：${error.message}`;$('material-error').hidden=false;}));
  $('material-file').addEventListener('change',event=>{if(event.target.files[0])$('material-form').elements.name.value=event.target.files[0].name;});
  $('candidate-form-content').addEventListener('submit',adopt);
  return { render, reset, pendingIssues, prepareAssumptions, changeRoute, cancel };
}
