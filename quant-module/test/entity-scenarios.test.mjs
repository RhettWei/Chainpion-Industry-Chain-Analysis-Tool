import test from 'node:test';
import assert from 'node:assert/strict';
import { computeQuant, validateQuant } from '../src/models.mjs';
import { neutralScenario, parseEvent } from '../src/scenarios.mjs';
import { runEventStudy } from '../src/core.mjs';
import { DEMO_INPUT } from '../src/demo.mjs';
import { findBaselineReferences } from '../src/references.mjs';
import { createAppServer } from '../server.mjs';
const near = (v,e) => assert.ok(Math.abs(v-e)<1e-8,`${v} != ${e}`);
function input(model='cost_transmission') {
  const value=structuredClone(DEMO_INPUT);
  value.analysis={model,scenarioMode:'entity'};
  value.context.eventDescription='宇树科技机器人灵巧手成本下降10%';
  value.parameters.horizonMonths=12;
  value.companies=['A','B'].map(id=>({id,name:id,role:'upstream',shockChannel:'cost',baselineRevenue:1000,baselineGrossMarginPct:20,rawMaterialCostSharePct:50,variableCostSharePct:75,fixedOperatingCost:100,evidenceIds:[],scope:{level:'product',product:'灵巧手',costItem:'电机采购',unit:'元/只'},scenario:neutralScenario()}));
  value.companies[0].scenario={...neutralScenario(),affected:true,costPct:-10};
  return value;
}
test('cost decline targets only the named object; same role is not equal exposure; cost cut is not auto price cut',()=>{
  const result=computeQuant(input()),[a,b]=result.companies;
  near(a.delta.grossProfit,40);near(a.delta.revenue,0);near(a.scenario.priceChangePct,0);near(b.delta.grossProfit,0);
  for(const scenario of result.scenarios) near(scenario.companies[1].delta.grossProfit,0);
  assert.match(result.summary.headline,/成本下降10%/);assert.equal(result.parameters.shockPct,undefined);
});
test('cost transfer on decline is explicit customer concession; price/volume/cost bridge reconciles',()=>{
  const data=input();data.companies[0].scenario.passThroughPct=50;
  let a=computeQuant(data).companies[0];near(a.delta.revenue,-20);near(a.delta.grossProfit,20);
  data.companies[0].scenario.pricePct=5;data.companies[0].scenario.volumePct=20;
  a=computeQuant(data).companies[0];near(a.bridge.reduce((s,r)=>s+r.value,0),a.delta.grossProfit);near(a.scenario.cogs,872);
});
test('volume-price defines product mean selling price and unit variable costs, never global shock',()=>{
  const data=input('volume_price');data.companies[0].scenario={...neutralScenario(),affected:true,pricePct:10,volumePct:20,costPct:-10};
  const [a,b]=computeQuant(data).companies;near(a.scenario.revenue,1320);near(a.scenario.cogs,848);near(a.delta.grossProfit,272);near(b.delta.grossProfit,0);
  data.parameters.shockPct=150;near(computeQuant(data).companies[0].delta.grossProfit,272);
});
test('CVP uses scenario unit cost and fixed opex once; no positive contribution stays null',()=>{
  const data=input('break_even');data.companies[0].scenario.fixedExpensePct=20;
  const a=computeQuant(data).companies[0];near(a.breakEven.variableCost,540);near(a.breakEven.fixedCost,320);near(a.breakEven.volumeIndex,320/460);near(a.scenario.operatingProfit,140);
  data.companies[0].scenario.pricePct=-80;assert.equal(computeQuant(data).companies[0].breakEven.revenue,null);
});
test('fixed expenses affect operating profit but never gross profit; missing required financials stay missing',()=>{
  const data=input('volume_price');data.companies[0].scenario.costPct=0;data.companies[0].scenario.fixedExpensePct=20;
  let a=computeQuant(data).companies[0];near(a.delta.grossProfit,0);near(a.delta.operatingProfit,-20);
  data.companies[0].baselineRevenue=null;assert.equal(computeQuant(data).companies[0].status,'missing');
});
test('explicit scope, unaffected-zero and stale event/scope are checked at API boundary',()=>{
  for(const edit of [d=>d.companies[0].scope.product='',d=>d.companies[0].scope.costItem='',d=>d.companies[1].scenario.costPct=-10,d=>d.companies[0].scenario.costPct=null,d=>d.analysis.eventMapping={description:'旧事件',eventDate:d.context.eventDate,modelId:'cost_transmission'}]) {const data=input();edit(data);assert.equal(validateQuant(data).valid,false);assert.throws(()=>computeQuant(data));}
  const data=input();data.analysis.baselineReview={confirmedAt:new Date().toISOString(),periodLabel:data.context.periodLabel,fields:data.companies.flatMap(c=>['baselineRevenue','baselineGrossMarginPct','variableCostSharePct','rawMaterialCostSharePct'].map(field=>({companyId:c.id,field,value:c[field],kind:'assumption'}))),scopes:data.companies.map(c=>({id:c.id,scope:structuredClone(c.scope)}))};
  data.companies[0].scenario.costPct=-20;assert.equal(validateQuant(data).valid,true);
  data.companies[0].scope.product='整车';assert.equal(validateQuant(data).valid,false);
});
test('event text parsing preserves sign and channel and never guesses multiple percentages or price meaning',()=>{
  assert.deepEqual(Object.fromEntries(['key','value'].map(k=>[k,parseEvent('宇树科技机器人灵巧手成本下降10%')[k]])),{key:'costPct',value:-10});
  assert.equal(parseEvent('正极材料售价提高10%').key,'pricePct');assert.equal(parseEvent('销量减少5%').value,-5);
  for(const text of ['价格上涨10%','成本下降10%、销量增加5%','成本下降-10%','政策出台'])assert.equal(parseEvent(text).status,'manual');
});
function olsData() {
  let stock=100,bench=100;const prices=[],benchmark=[];
  for(let i=0;i<75;i++){const date=new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),m=(i%7-3)*.1,noise=i===60?2:0;bench*=1+m/100;stock*=1+(.2+1.5*m+noise)/100;benchmark.push({date,close:bench});prices.push({date,close:stock,adjFactor:1,volume:100+i});}
  return {companies:[{id:'s',name:'合成OLS',prices}],benchmark,eventDate:prices[60].date,asOf:prices.at(-1).date,before:3,after:3};
}
test('OLS fits alpha/beta on event-preceding window only; event excess is not fitted away',()=>{
  const data=olsData(),result=runEventStudy({...data,expectedReturnModel:'market_model'}),fit=result.companies[0].estimation;
  assert.equal(result.status,'available');near(fit.alpha,.2);near(fit.beta,1.5);near(fit.rSquared,1);near(result.series.at(-1).car,2);
  assert.ok(fit.endDate<data.benchmark[57].date);
});
test('OLS insufficient/constant market baseline never silently falls back or fabricates returns',()=>{
  const data=olsData();data.benchmark=data.benchmark.map(r=>({...r,close:100}));
  const result=runEventStudy({...data,expectedReturnModel:'market_model'});assert.equal(result.series.length,0);assert.equal(result.companies[0].estimation,null);assert.match(result.warnings.join(' '),/不偷偷回退/);
});
test('segment reference request never adopts consolidated income',async()=>{
  let calls=0;const result=await findBaselineReferences({companyName:'测试企业',field:'baselineRevenue',code:'000001.SZ',periodEnd:'2025-12-31',asOf:'2026-09-30',scope:{level:'product',product:'灵巧手'}},{token:'synthetic',fetchImpl:async()=>{calls++;throw new Error('must not query');}});
  assert.equal(calls,0);assert.equal(result.candidates.length,0);assert.match(result.query,/灵巧手/);assert.match(result.warnings.join(' '),/不采用Tushare公司合并财报/);
});
test('browser calculation modules are served and structured report includes product, cost item and independent parameter',async()=>{
  const server=createAppServer({});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  try{for(const path of ['/src/scenarios.mjs','/entity-workflow.mjs','/impact-charts.mjs'])assert.equal((await fetch(origin+path)).status,200);
    const response=await fetch(origin+'/api/export',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input:input(),result:{},format:'markdown',detail:'brief'})});assert.equal(response.status,200);const text=await response.text();assert.match(text,/灵巧手/);assert.match(text,/电机采购/);assert.match(text,/-10/);assert.ok(!text.includes('原料 / 售价冲击（%）'));
  }finally{await new Promise(r=>server.close(r));}
});
