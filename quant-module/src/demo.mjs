// 全部演示公司、财务和行情均为合成假设；不对应真实企业或市场观测。
export const DEMO_INPUT = {
  schemaVersion: '1.0',
  context: {
    industry: '新能源汽车 · 动力电池',
    eventDescription: '原材料价格上涨情景（演示假设）',
    eventDate: '2026-09-01',
    asOf: '2026-10-02',
    periodLabel: '年度基线（万元）',
  },
  parameters: {
    shockPct: 10,
    volumePct: 0,
    passThroughPct: 40,
    exposurePct: 100,
    lagMonths: 1,
    horizonMonths: 12,
  },
  companies: [
    {
      id: 'demo-upstream',
      name: '资源供应商 A',
      role: 'upstream',
      shockChannel: 'selling_price',
      baselineRevenue: 100000,
      baselineGrossMarginPct: 30,
      rawMaterialCostSharePct: 20,
      variableCostSharePct: 80,
      fixedOperatingCost: 12000,
      evidenceIds: ['demo-baseline', 'demo-scenario'],
    },
    {
      id: 'demo-midstream',
      name: '电池材料商 B',
      role: 'midstream',
      shockChannel: 'cost',
      baselineRevenue: 150000,
      baselineGrossMarginPct: 22,
      rawMaterialCostSharePct: 65,
      variableCostSharePct: 85,
      fixedOperatingCost: 14000,
      evidenceIds: ['demo-baseline', 'demo-scenario'],
    },
    {
      id: 'demo-downstream',
      name: '整车制造商 C',
      role: 'downstream',
      shockChannel: 'cost',
      baselineRevenue: 300000,
      baselineGrossMarginPct: 18,
      rawMaterialCostSharePct: 30,
      variableCostSharePct: 75,
      fixedOperatingCost: 35000,
      evidenceIds: ['demo-baseline', 'demo-scenario'],
    },
  ],
  evidence: [
    {
      id: 'demo-baseline',
      kind: 'assumption',
      title: '虚构企业年度基线 · 演示假设',
      source: '模块内置演示，无真实财报或市场观测',
      description: '企业名称、收入、毛利率、原料及变动成本占比、固定经营费用均为人工设定的演示值。货币统一为万元，占比统一为百分比。',
      publishedAt: '2026-10-02',
    },
    {
      id: 'demo-scenario',
      kind: 'assumption',
      title: '原料涨幅与转嫁率 · 演示假设',
      source: '模块内置情景参数，无真实采购价格或合同证据',
      description: '原料涨幅 10%、销量不变、成本转嫁率 40%、业务暴露 100%、时滞 1 个月均为可调整假设，不是预测或已发生事实。',
      publishedAt: '2026-10-02',
    },
  ],
};

// 保留空值可验证数据不足时的降级行为；不得自动填成 0。
export const emptyInput = {
  schemaVersion: '1.0',
  context: {
    industry: '',
    eventDescription: '',
    eventDate: '',
    asOf: '2026-10-02',
    periodLabel: '年度基线（万元）',
  },
  parameters: {
    shockPct: 10,
    volumePct: 0,
    passThroughPct: 40,
    exposurePct: 100,
    lagMonths: 1,
    horizonMonths: 12,
  },
  companies: [
    {
      id: 'user-company-1',
      name: '待补充企业',
      role: 'midstream',
      shockChannel: 'cost',
      baselineRevenue: null,
      baselineGrossMarginPct: null,
      rawMaterialCostSharePct: null,
      variableCostSharePct: null,
      fixedOperatingCost: null,
      evidenceIds: [],
    },
  ],
  evidence: [],
};

const isoDate = date => date.toISOString().slice(0, 10);
function weekdayDates(eventDate, count, direction) {
  const cursor = new Date(`${eventDate}T00:00:00Z`);
  const dates = [];
  while (dates.length < count) {
    cursor.setUTCDate(cursor.getUTCDate() + direction);
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) dates.push(isoDate(cursor));
  }
  return direction < 0 ? dates.reverse() : dates;
}

const eventDate = DEMO_INPUT.context.eventDate;
const dates = [...weekdayDates(eventDate, 60, -1), eventDate, ...weekdayDates(eventDate, 10, 1)];
const benchmarkReturns = dates.map((_, index) => 0.0003 + Math.sin(index * 0.63) * 0.004 + Math.cos(index * 0.19) * 0.002);
let benchmarkClose = 3000;
const benchmark = dates.map((date, index) => {
  benchmarkClose *= 1 + benchmarkReturns[index];
  return { date, close: Number(benchmarkClose.toFixed(6)) };
});
const eventEffects = [0.025, -0.02, -0.008];
const companies = DEMO_INPUT.companies.map((company, companyIndex) => {
  let close = [20, 50, 80][companyIndex];
  const prices = dates.map((date, index) => {
    const postDay = index - 60;
    const designedShock = postDay === 0 ? eventEffects[companyIndex] : postDay > 0 ? eventEffects[companyIndex] * 0.06 * Math.exp(-postDay / 5) : 0;
    const returnValue = benchmarkReturns[index] * [0.9, 1.1, 1.2][companyIndex] + Math.sin(index * 0.91 + companyIndex) * 0.003 + designedShock;
    close *= 1 + returnValue;
    const baseVolume = [1800000, 2600000, 3900000][companyIndex];
    const volumeMultiplier = postDay === 0 ? 1.8 : postDay > 0 ? 1.3 : 1;
    return {
      date,
      close: Number(close.toFixed(6)),
      volume: Math.round(baseVolume * (1 + Math.cos(index * 0.27 + companyIndex) * 0.12) * volumeMultiplier),
      adjFactor: 1,
    };
  });
  return { id: company.id, name: `${company.name}（合成行情）`, role: company.role, prices };
});

export const DEMO_MARKET_DATA = {
  eventDate,
  asOf: DEMO_INPUT.context.asOf,
  before: 5,
  after: 5,
  companies,
  benchmark,
  provenance: {
    provider: '演示合成行情',
    kind: 'assumption',
    title: '虚构企业与基准的确定性合成行情',
    description: '所有行情点由固定公式生成，包含事件前 60 个工作日、事件当日和事件后 10 个工作日。工作日不代表真实交易日，合成事件效应不构成市场观测或历史回测。',
    eventDate,
    asOf: DEMO_INPUT.context.asOf,
    adjusted: true,
  },
  usage: { requests: 0, provider: '演示合成行情', description: '内置演示未调用外部数据接口' },
};
