import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { computeQuant } from '../quant-module/src/models.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
for (const [file, expected] of [['compute-input.json', [110, 75.6, 34.4]], ['lithium-input.json', [100, 68.6, 31.4]]]) {
  const input = JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8'));
  const object = computeQuant(input).companies[0];
  const values = [object.scenario.revenue, object.scenario.cogs, object.scenario.grossProfit].map(x => x * 10000);
  values.forEach((value, i) => near(value, expected[i]));
  console.log(JSON.stringify({ case: file, unit: 'CNY', revenue: values[0], cost: values[1], grossProfit: values[2], status: 'passed' }));
}
