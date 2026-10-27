import { computeQuant, modelFor } from './models.mjs';

export function scenarioGrid(input, company) {
  const model = modelFor(input), safety = model.id === 'break_even';
  const horizontal = model.id === 'cost_transmission' ? 'costPct' : 'pricePct';
  const axis = (center, min, max) => [...new Set([-15, -10, -5, 0, 5, 10, 15].map(d => Math.max(min, Math.min(max, center + d))))];
  const xs = axis(company.scenario[horizontal], -90, 200), ys = axis(company.scenario.volumePct, -90, 100).reverse();
  const at = (price, volume) => computeQuant({ ...input, analysis: { model: model.id, scenarioMode: 'entity' }, companies: [{ ...company, scenario: { ...company.scenario, [horizontal]: price, volumePct: volume } }] }).companies[0];
  return { horizontal, safety, xs, ys,
    cells: ys.flatMap((volume, row) => xs.map((price, col) => { const result = at(price, volume); return { row, col, price, volume, value: safety ? result.scenario?.operatingProfit : result.delta?.grossProfit }; })),
    // Continuous zero-profit boundary under the same fixed cost assumptions.
    boundary: safety ? xs.map(price => ({ price, volume: at(price, 0).breakEven?.requiredVolumeChangePct })) : [],
  };
}

export function marketMatrix(result) {
  const dates = result.window.dates || [...new Map(result.companies.flatMap(c => c.daily).map(r => [r.date, { date: r.date, day: r.day }])).values()].sort((a, b) => a.day - b.day);
  return { dates, rows: result.companies.map(company => ({ ...company, cells: dates.map(date => ({ ...date, value: company.daily.find(r => r.date === date.date)?.abnormal ?? null })) })) };
}
