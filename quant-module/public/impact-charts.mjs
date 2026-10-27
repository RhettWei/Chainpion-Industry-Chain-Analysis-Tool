import { scenarioGrid, marketMatrix } from '/src/visual-data.mjs';
import { formatValue as fmt, signedValue as sign, displayValue } from '/src/display.mjs';
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const begin = (height, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 ${height}" role="img" aria-label="${esc(title)}" style="font-family:Microsoft YaHei,Arial,sans-serif;background:#fff"><title>${esc(title)}</title>`;
export function comparisonBars(rows, { market = false, target = 'grossProfit' } = {}) {
  const metricLabel = target === 'operatingProfit' ? '经营利润变化' : '毛利变化';
  const values = rows.filter(r=>Number.isFinite(market?r.car:r.delta?.[target])).sort((a,b)=>(market?b.car:b.delta[target])-(market?a.car:a.delta[target]));
  if (!values.length) return '<p class="empty">待计算</p>';
  const height = 80 + values.length*66, extent = Math.max(1,...values.map(r=>Math.abs(market?r.car:r.delta[target]))), x = v=>480+v/extent*155;
  let svg=begin(height,market?'各证券异常收益比较':`各对象${metricLabel}比较`);
  svg+=`<line x1="480" x2="480" y1="25" y2="${height-30}" stroke="#9faeb7"/><text x="480" y="16" text-anchor="middle" font-size="12" fill="#607681">0 · ${market?'CAR（pp）':`${metricLabel}（万元）`}</text>`;
  values.forEach((r,i)=>{ const value=displayValue(market?r.car:r.delta[target],market?2:1), y=34+i*66, fill=value>0?'#159b80':value<0?'#d87157':'#a0adb7';
    svg+=`<g><title>${esc(r.name)}：${sign(value,market?2:1)}${market?'pp':'万元'}</title><text x="8" y="${y+18}" font-size="15" fill="#153b4b">${esc(r.name.slice(0,20))}</text><text x="8" y="${y+36}" font-size="12" fill="#607681">${esc(market?`${r.sampleDays}/${r.expectedDays}日`:r.affected?'独立受影响对象':'未受影响 · 保持基线')}</text><rect x="${Math.min(480,x(value))}" y="${y+2}" width="${Math.max(2,Math.abs(x(value)-480))}" height="25" rx="4" fill="${fill}"/><text x="${x(value)+(value<0?-7:7)}" y="${y+20}" text-anchor="${value<0?'end':'start'}" fill="${fill}" font-size="14">${sign(value,market?2:1)}</text></g>`;
  }); return `${svg}</svg>`;
}
function baselineBars(row) {
  const keys=[['revenue','收入'],['cogs','营业成本'],['grossProfit','毛利'],...(row.baseline.operatingProfit!==undefined?[['operatingProfit','经营利润']]:[])], extent=Math.max(1,...keys.flatMap(([k])=>[Math.abs(row.baseline[k]),Math.abs(row.scenario[k])]));
  const hasNegative=keys.some(([k])=>row.baseline[k]<0||row.scenario[k]<0), height=hasNegative?395:270;
  const width=600/keys.length, y=v=>195-v/extent*145;
  let svg=begin(height,'同一对象基线与情景比较');
  svg+=`<line x1="70" x2="715" y1="195" y2="195" stroke="#adbcc4"/><text x="15" y="30" fill="#607681" font-size="12">万元 · 负值向下</text>`;
  keys.forEach(([k,label],i)=>{const x=105+i*width;for(const [v,fill,off] of [[row.baseline[k],'#a0adb7',0],[row.scenario[k],'#159b80',42]]) svg+=`<g><title>${label} ${off?'情景':'基线'}：${fmt(v)}万元</title><rect x="${x+off}" y="${Math.min(y(v),195)}" width="33" height="${Math.max(2,Math.abs(y(v)-195))}" rx="3" fill="${fill}"/><text x="${x+off+16}" y="${v<0?y(v)+15:y(v)-9}" text-anchor="middle" font-size="12" fill="#47616d">${fmt(v)}</text></g>`;svg+=`<text x="${x+37}" y="${height-27}" text-anchor="middle" font-size="13" fill="#153b4b">${label}</text>`;});
  return `${svg}<text x="80" y="${height-5}" font-size="12" fill="#607681">灰：基线　绿：情景</text></svg>`;
}
function heatmap(state, company) {
  if (!company.scenario.affected) return '<p class="empty">该对象未受影响</p>';
  const { horizontal, safety, xs, ys, cells, boundary } = scenarioGrid(state.input, company);
  const cellW = 560/xs.length, cellH = 280/ys.length, label = safety ? '经营利润' : '毛利变化';
  const extent=Math.max(1,...cells.filter(c=>Number.isFinite(c.value)).map(c=>Math.abs(c.value)));
  let svg=begin(410,safety?'可交互的量价经营安全区':'可交互的双参数毛利变化矩阵');
  svg+=`<text x="92" y="25" font-size="11" fill="#607681">行：销量变化%　列：${horizontal==='costPct'?'指定成本项单价':'产品均价'}变化%　格内：${label}（万元）</text>`;
  xs.forEach((v,i)=>svg+=`<text x="${96+(i+.5)*cellW}" y="54" text-anchor="middle" font-size="12" fill="#153b4b">${sign(v,0)}%</text>`);
  ys.forEach((v,i)=>svg+=`<text x="79" y="${66+(i+.5)*cellH+4}" text-anchor="end" font-size="12" fill="#153b4b">${sign(v,0)}%</text>`);
  for(const c of cells){const v=displayValue(c.value), a=v===null?0:.12+Math.abs(v)/extent*.65, fill=v===null?'#e8eef1':v===0?'#edf0f2':v>0?`rgba(21,155,128,${a})`:`rgba(216,113,87,${a})`, current=c.price===company.scenario[horizontal]&&c.volume===company.scenario.volumePct;
    const cellFont = Math.max(9, Math.min(14, (cellW-8)/(sign(c.value).length*.65)));
    svg+=`<g tabindex="0" role="button" data-heat-company="${esc(company.id)}" data-heat-key="${horizontal}" data-heat-price="${c.price}" data-heat-volume="${c.volume}" aria-label="${horizontal==='costPct'?'成本':'售价'}${c.price}%，销量${c.volume}%，${label}${fmt(c.value)}万元"><title>点击采用：${horizontal==='costPct'?'成本':'售价'} ${c.price}%；销量 ${c.volume}%；${label} ${sign(c.value)}万元</title><rect x="${96+c.col*cellW}" y="${66+c.row*cellH}" width="${cellW-3}" height="${cellH-3}" rx="4" fill="${fill}" stroke="${current?'#153b4b':'transparent'}" stroke-width="${current?3:0}"/><text x="${96+(c.col+.5)*cellW}" y="${66+(c.row+.5)*cellH+4}" text-anchor="middle" font-size="${cellFont}" font-weight="600" fill="#153b4b" pointer-events="none">${sign(c.value)}</text></g>`;
  }
  if (safety) {
    const y = volume => {
      let i = ys.findIndex((v,index) => index<ys.length-1 && volume<=v && volume>=ys[index+1]);
      if(i<0) i=volume>ys[0]?0:ys.length-2;
      return 66+cellH/2+(i+(ys[i]-volume)/(ys[i]-ys[i+1]))*cellH;
    };
    svg+=`<defs><clipPath id="safety-clip"><rect x="96" y="66" width="560" height="280"/></clipPath></defs><g clip-path="url(#safety-clip)" pointer-events="none">`;
    boundary.forEach((point,i) => { const previous=boundary[i-1]; if(previous && Number.isFinite(previous.volume) && Number.isFinite(point.volume)) svg+=`<line x1="${96+(i-.5)*cellW}" y1="${y(previous.volume)}" x2="${96+(i+.5)*cellW}" y2="${y(point.volume)}" stroke="#153b4b" stroke-width="2" stroke-dasharray="5 4"/>`; });
    svg+='</g>';
  }
  return `${svg}<text x="96" y="372" fill="#607681" font-size="11">${safety?'绿＝盈利，橙＝亏损；虚线＝零利润门槛（点间近似）。':'绿＝毛利增加，橙＝毛利减少。'}灰＝显示精度内为零。</text><text x="96" y="395" fill="#607681" font-size="11">边框＝当前组合 · 点击／回车采用</text></svg>`;
}
export function renderImpactCharts(state) {
  const row=state.result?.companies.find(c=>c.id===state.selected), company=state.input.companies.find(c=>c.id===state.selected);
  $('impact-ranking').innerHTML=comparisonBars(state.result?.companies || [],{target:state.input.analysis.model==='break_even'?'operatingProfit':'grossProfit'});
  $('baseline-chart').innerHTML=row?.status==='estimated'?baselineBars(row):'<p class="empty">选择一个可计算对象查看基线与情景。</p>';
  $('impact-heatmap').innerHTML=row?.status==='estimated'&&company?heatmap(state,company):'<p class="empty">待计算</p>';
}
export function renderMarketBars(result) {
  $('market-impact-bars').innerHTML=comparisonBars(result.companies,{market:true});
  const { dates, rows } = marketMatrix(result);
  if(!dates.length) { $('market-response-matrix').innerHTML='<p class="empty">暂无事件窗口日收益。</p>'; return; }
  const cellW=44, left=210, width=Math.max(760,left+dates.length*cellW+110), height=130+rows.length*70;
  const extent=Math.max(.01,...rows.flatMap(r=>r.cells).filter(c=>c.value!==null).map(c=>Math.abs(c.value)));
  let svg=begin(height,'各证券每日异常收益AR反应分化矩阵').replace('760 ',`${width} `);
  svg+=`<text x="12" y="22" fill="#607681" font-size="12">每日AR（pp） · ${esc(result.method)}</text>`;
  dates.forEach((d,i)=>svg+=`<text x="${left+(i+.5)*cellW}" y="50" text-anchor="middle" font-size="12" fill="${d.day===0?'#9c6a20':'#153b4b'}">T${d.day>0?'+':''}${d.day}</text>`);
  svg+=`<text x="${left+dates.length*cellW+55}" y="50" text-anchor="middle" fill="#153b4b" font-size="12">窗口CAR</text>`;
  rows.forEach((r,i)=>{
    const y=63+i*70;
    svg+=`<text x="12" y="${y+20}" fill="#153b4b" font-size="14">${esc(r.name.slice(0,22))}</text><text x="12" y="${y+40}" fill="#607681" font-size="11">${esc(r.id)} · ${r.sampleDays}/${r.expectedDays}日</text>`;
    r.cells.forEach((c,j)=>{ const v=displayValue(c.value,2),fill=v===null?'#e2e8ed':v===0?'#f1f4f6':v>0?`rgba(21,155,128,${.18+Math.abs(v)/extent*.6})`:`rgba(216,113,87,${.18+Math.abs(v)/extent*.6})`, description=`${r.name} ${c.date} T${c.day>0?'+':''}${c.day}：${c.value===null?'日收益缺失，未按零处理':`AR ${sign(c.value,4)} pp`}`;
      svg+=`<g tabindex="0" aria-label="${esc(description)}"><title>${esc(description)}</title><rect x="${left+j*cellW}" y="${y}" width="41" height="43" rx="4" fill="${fill}" stroke="${c.day===0?'#9c6a20':'none'}"/><text x="${left+(j+.5)*cellW}" y="${y+26}" text-anchor="middle" fill="#153b4b" font-size="11">${c.value===null?'缺':sign(c.value,2)}</text></g>`;
    });
    svg+=`<text x="${left+dates.length*cellW+55}" y="${y+26}" text-anchor="middle" fill="#153b4b" font-size="16">${sign(r.car,2)}</text>`;
  });
  $('market-response-matrix').innerHTML=`${svg}<text x="12" y="${height-32}" fill="#607681" font-size="11">绿＝正AR · 橙＝负AR · 浅灰＝零 · 深灰“缺”＝无收益 · 金框＝T0</text><text x="12" y="${height-12}" fill="#607681" font-size="11">右列：单证券CAR；组合使用共同日期。</text></svg>`;
  $('market-response-matrix').querySelector('svg').style.minWidth=`${width}px`;
}
