import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const publicDir = new URL('../public/',import.meta.url);
test('compact UI retains every literal DOM anchor used by its modules', async () => {
  const names = (await readdir(publicDir)).filter(name=>name.endsWith('.mjs'));
  const html = await readFile(new URL('index.html',publicDir),'utf8');
  const scripts = await Promise.all(names.map(name=>readFile(new URL(name,publicDir),'utf8')));
  const markup = [html,...scripts].join('\n');
  const ids = new Set([...markup.matchAll(/\bid="([\w-]+)"/g)].map(match=>match[1]));
  const refs = new Set(scripts.flatMap(code=>[...code.matchAll(/\$\('([\w-]+)'\)/g)].map(match=>match[1])));
  assert.deepEqual([...refs].filter(id=>!ids.has(id)),[]);
  const staticIds = [...html.matchAll(/\bid="([\w-]+)"/g)].map(match=>match[1]);
  assert.equal(staticIds.length,new Set(staticIds).size,'static IDs must remain unique');
});

test('compact UI removes tutorials but retains auditable methods and essential labels', async () => {
  const html = await readFile(new URL('index.html',publicDir),'utf8');
  assert.doesNotMatch(html,/先知道这些边界|不用盲等|一次运行使用一个模型|不必先勾选研究主题/);
  assert.match(html,/<details><summary>模型方法与适用边界<\/summary><div id="methods">/);
  for(const id of ['model-dialog','trace-dialog','baseline-snapshot','baseline-ack','candidate-dialog','market-mode','mode-tag']) {
    assert.ok(html.includes(`id="${id}"`),id);
  }
});
