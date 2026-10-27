import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_INPUT, DEMO_MARKET_DATA } from '../src/demo.mjs';
import { computeQuant } from '../src/models.mjs';
import { neutralScenario } from '../src/scenarios.mjs';
import { scenarioGrid, marketMatrix } from '../src/visual-data.mjs';
import { signedValue, valueClass, displayValue } from '../src/display.mjs';
import { buildReport } from '../src/reports.mjs';
import { createAppServer } from '../server.mjs';
import { inflateRawSync } from 'node:zlib';

function operating(model, parameters) {
  const input = structuredClone(DEMO_INPUT);
  input.analysis = { model, scenarioMode: 'entity' };
  input.companies = [{ id:'A',name:'A',role:'upstream',shockChannel:'price',baselineRevenue:1000,baselineGrossMarginPct:20,variableCostSharePct:75,rawMaterialCostSharePct:50,fixedOperatingCost:100,evidenceIds:[],scope:{level:'product',product:'灵巧手',costItem:'电机采购',unit:'元/只'},scenario:{...neutralScenario(),affected:true,...parameters} }];
  return input;
}
function xml(buffer) {
  let cursor=0;
  while(buffer.readUInt32LE(cursor)===0x04034b50) {
    const length=buffer.readUInt32LE(cursor+18), size=buffer.readUInt16LE(cursor+26), extra=buffer.readUInt16LE(cursor+28), start=cursor+30+size+extra;
    if(buffer.subarray(cursor+30,cursor+30+size).toString()==='word/document.xml') return inflateRawSync(buffer.subarray(start,start+length)).toString();
    cursor=start+length;
  }
  throw new Error('Missing Word document');
}
test('near-zero display has no positive/negative sign or class, while raw calculation remains unchanged',()=>{
  for(const n of [0,1e-12,-1e-12,.049,-.049]) { assert.equal(signedValue(n),'0.0'); assert.equal(valueClass(n),'neutral'); }
  assert.equal(signedValue(.051),'+0.1'); assert.equal(signedValue(.009,2),'+0.01');
  assert.equal(displayValue(null),null); assert.equal(signedValue(null),'—');
  const input=operating('volume_price',{pricePct:10,volumePct:-20});
  const row=computeQuant(input).companies[0]; assert.ok(Math.abs(row.delta.grossProfit)<1e-9); assert.equal(signedValue(row.delta.grossProfit),'0.0');
});
test('operating safety grid reconciles with operating profit; threshold solves zero; axes are unique at limits',()=>{
  const input=operating('break_even',{pricePct:-10,volumePct:0,fixedExpensePct:20}), grid=scenarioGrid(input,input.companies[0]);
  assert.equal(grid.safety,true); assert.ok(Math.abs(grid.cells.find(c=>c.price===-10&&c.volume===0).value+20)<1e-9);
  const threshold=grid.boundary.find(c=>c.price===-10).volume; assert.ok(Math.abs(threshold-6.6666666667)<1e-8);
  input.companies[0].scenario.volumePct=threshold; assert.ok(Math.abs(computeQuant(input).companies[0].scenario.operatingProfit)<1e-8);
  input.companies[0].scenario.pricePct=-50; assert.equal(scenarioGrid(input,input.companies[0]).boundary.find(c=>c.price===-50).volume,null);
  input.companies[0].scenario.pricePct=-90;input.companies[0].scenario.volumePct=100;
  const edge=scenarioGrid(input,input.companies[0]); assert.equal(new Set(edge.xs).size,edge.xs.length);assert.equal(new Set(edge.ys).size,edge.ys.length);
});
test('AR matrix contains every target date, CAR equals daily cells; missing data is not zero',()=>{
  const input=structuredClone(DEMO_INPUT); input.analysis={model:'event_study',marketMethod:'market_model'};
  const data=structuredClone(DEMO_MARKET_DATA);data.companies[1].prices=data.companies[1].prices.filter(r=>r.date!==input.context.eventDate);
  const market=computeQuant(input,{marketData:data,before:5,after:5}).marketStudy, matrix=marketMatrix(market);
  assert.equal(matrix.dates.length,11);assert.equal(matrix.rows[1].cells.find(c=>c.day===0).value,null);
  for(const row of matrix.rows) assert.ok(Math.abs(row.cells.reduce((sum,c)=>sum+(c.value??0),0)-row.car)<1e-9);
  assert.equal(matrix.dates[5].day,0);
});
test('brief and full reports include all five securities; all daily rows survive; irrelevant financial assumptions excluded in all formats',()=>{
  const input=structuredClone(DEMO_INPUT);input.analysis={model:'event_study',marketMethod:'market_model',scenarioMode:'entity'};
  input.evidence.push({id:'unused',title:'无关原料假设X',kind:'assumption',source:'经营成本',url:'https://unused.example/'});
  const data=structuredClone(DEMO_MARKET_DATA);data.companies.push({...structuredClone(data.companies[0]),id:'D',name:'第四证券'}, {...structuredClone(data.companies[2]),id:'E',name:'第五证券'});
  const result=computeQuant(input,{marketData:data,before:10,after:10}), market=result.marketStudy;
  assert.deepEqual(result.companies,[]);assert.deepEqual(result.sensitivity,[]);assert.deepEqual(result.scenarios,[]);assert.deepEqual(result.parameters,{});
  for(const detail of ['brief','full']) for(const format of ['markdown','html','docx']) {
    const report=buildReport({input,result,marketResult:{...market,dataProvenance:data.provenance},detail,format});
    const text=format==='docx'?xml(report.buffer):report.buffer.toString();
    for(const row of market.companies) {assert.ok(text.includes(row.name));assert.ok(text.includes(String(Math.round(row.car*1e6)/1e6)));}
    for(const label of ['无关原料假设X','unused.example','企业经营影响与情景比较','三情景压力测试','企业输入与证据定位','原料涨幅','分析期限（月）']) assert.ok(!text.includes(label),label);
    assert.match(text,/OLS/); assert.match(text,/非真实市场数据/);
    if(detail==='full') {assert.match(text,/逐证券每日计算明细/);const last=market.companies.at(-1).daily.at(-1);assert.ok(text.includes(String(Math.round(last.abnormal*1e6)/1e6)));}
  }
});
test('CVP export leads with operating profit and threshold rather than generic gross-profit ranking',()=>{
  const input=operating('break_even',{pricePct:-10,fixedExpensePct:20});
  const text=buildReport({input,result:computeQuant(input),format:'markdown',detail:'brief'}).buffer.toString();
  assert.match(text,/情景经营利润（万元）/);assert.match(text,/960/);assert.match(text,/-6.666667/);
  assert.ok(!text.includes('相对最有利企业'));
});
test('new browser data/display modules are served without exposing other source files',async()=>{
  const server=createAppServer({});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  try {for(const path of ['/src/display.mjs','/src/visual-data.mjs']) assert.equal((await fetch(origin+path)).status,200);assert.equal((await fetch(origin+'/src/reports.mjs')).status,404);}
  finally {await new Promise(r=>server.close(r));}
});
