// Build a source-only teammate handoff. No environment variables or uploaded files are copied.
import { readdir, readFile, copyFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { dirname, resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DEMO_INPUT, DEMO_MARKET_DATA } from '../src/demo.mjs';
import { computeQuant } from '../src/models.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageInfo = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const day = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
const stage = process.argv[2] ? resolve(process.argv[2]) : resolve(root, '..', '分享交付', `v${packageInfo.version}_${day}`);
// Never overwrite a prior delivery or use the source checkout as the staging directory.
if (stage === root || stage.startsWith(`${root}\\`) || stage.startsWith(`${root}/`)) throw new Error('分享目录必须与源码目录分离。');
await mkdir(stage, { recursive: false });
const destination = join(stage, 'quant-module');
await mkdir(destination);
const files = [];
const allowed = {
  public: new Set(['.html','.css','.mjs','.js','.svg','.png','.ico']),
  src: new Set(['.mjs']),
  contracts: new Set(['.json']),
  test: new Set(['.mjs','.json']),
};
async function copy(relativePath) {
  const source = join(root, relativePath), target = join(destination, relativePath);
  if (!(await lstat(source)).isFile()) throw new Error(`只允许普通文件：${relativePath}`);
  const bytes = await readFile(source);
  // Tushare credentials and common provider secret literals must not enter a handoff.
  // Report the filename only: never print matched secret text.
  if (/\b[a-f\d]{64}\b|\b(?:sk|sk-proj)-[A-Za-z0-9_-]{20,}/i.test(bytes.toString('utf8'))) throw new Error(`需人工检查疑似凭证：${relativePath}`);
  await mkdir(dirname(target), { recursive:true });
  await copyFile(source, target);
  files.push(relativePath.replaceAll('\\','/'));
}
async function copyDirectory(folder, relativePath = folder) {
  for (const entry of await readdir(join(root, relativePath), { withFileTypes:true })) {
    if (entry.name.startsWith('.') || /^(node_modules|artifacts|output)$/i.test(entry.name) || /\.(?:log|token|zip)$/i.test(entry.name)) throw new Error(`源码子目录含不应打包项：${join(relativePath,entry.name)}`);
    const path = join(relativePath, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`不打包符号链接：${path}`);
    if (entry.isDirectory()) await copyDirectory(folder,path);
    else if (entry.isFile() && allowed[folder].has(extname(entry.name))) await copy(path);
    else throw new Error(`需人工确认文件：${path}`);
  }
}
for (const filename of ['.gitignore','server.mjs','package.json','README.md','启动与对接说明.md','交付验收.md','启动量化模块.cmd','start.ps1']) await copy(filename);
for (const folder of Object.keys(allowed)) await copyDirectory(folder);
await copy('scripts/package-share.mjs');

const examples = join(destination, 'examples');
await mkdir(examples);
const operating = JSON.parse(await readFile(join(root,'test/fixtures/entity-cost-decline.json'),'utf8'));
const volumePrice = structuredClone(operating);
volumePrice.analysis.model = 'volume_price';
volumePrice.context.eventDescription = '虚构灵巧手业务平均售价提高10%（研究假设）';
volumePrice.companies[0].scenario.costPct = 0;
volumePrice.companies[0].scenario.pricePct = 10;
const breakEven = structuredClone(volumePrice);
breakEven.analysis.model = 'break_even';
breakEven.context.eventDescription = '虚构业务售价下降10%、销量增加15%、固定经营费用增加20%（研究假设）';
Object.assign(breakEven.companies[0].scenario,{pricePct:-10,volumePct:15,fixedExpensePct:20});
const marketRequest = {
  input: { schemaVersion:'1.0', analysis:{model:'event_study',marketMethod:'market_model'}, context:{industry:DEMO_INPUT.context.industry,eventDescription:'仅用于验收的合成行情事件',eventDate:DEMO_INPUT.context.eventDate,asOf:DEMO_INPUT.context.asOf} },
  marketData:DEMO_MARKET_DATA, before:5, after:5,
};
for (const [filename,value] of [['成本传导输入_虚构.json',operating],['量价利润输入_虚构.json',volumePrice],['盈亏平衡输入_虚构.json',breakEven],['事件研究请求_合成行情.json',marketRequest]]) {
  // Validate every generated example with the same entry point as the integration API.
  computeQuant(value.input || value,{marketData:value.marketData,before:value.before,after:value.after});
  await writeFile(join(examples,filename),JSON.stringify(value,null,2)+'\n','utf8');
  files.push(`examples/${filename}`);
}

const records = [];
for (const filename of files.sort()) { const bytes = await readFile(join(destination,filename)); records.push({path:`quant-module/${filename}`,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}); }
await writeFile(join(stage,'文件清单与校验.json'),JSON.stringify({version:packageInfo.version,packagedOn:day,timezone:'Asia/Shanghai',fileCount:records.length,excluded:['真实凭证和环境配置','历史artifacts/私人上传资料','node_modules和本机运行时','.git和其他项目','历史依赖artifacts的verify-export脚本'],files:records},null,2)+'\n','utf8');
console.log(JSON.stringify({stage,module:destination,version:packageInfo.version,fileCount:records.length},null,2));
