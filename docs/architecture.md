# 结构与集成

## 运行单元

```text
用户
├─ frontend/：v1.7.3产业研究网页交付
│  ├─ 事件与研究范围
│  ├─ 三维产业全景、节点与路径
│  ├─ 量化与案例展示
│  └─ 资料、成果与保存版本
└─ quant-module/：v0.4.2独立量化源码
   ├─ public/：参数准备、审核、可视化与导出界面
   ├─ server.mjs：同源HTTP服务
   ├─ src/models.mjs：四模型统一入口
   ├─ src/scenarios.mjs：逐对象参数及校验
   ├─ src/core.mjs：基础经营计算与事件研究
   ├─ src/references.mjs、materials.mjs：候选数据与资料提取
   ├─ src/reports.mjs：Word、HTML、Markdown报告
   └─ contracts/、test/：输入结构与回归测试
```

当前两个单元分别启动。`frontend/`保存可运行构建产物，主模块开发源工程在团队后续集成时补充；独立量化服务可以通过函数或HTTP接口接入主Agent后端。

## 量化服务接口

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/health` | 服务状态与外部数据凭据配置状态 |
| `POST /api/compute` | 参数校验与四模型计算 |
| `POST /api/market-data` | 按截止日查询证券与基准行情 |
| `POST /api/baseline-references` | 返回待审核的基准候选 |
| `POST /api/material-extract` | 本地资料文字提取与候选检索 |
| `POST /api/export` | 生成报告或临时下载地址 |
| `GET /api/download/:id` | 获取临时报告文件 |

经营请求可直接提交input，或使用 `{ input, marketData, before, after }`。返回 `baseline`、`scenario`、`delta`、贡献、方法、警告与缺失项。

## 主Agent如何接入

主后端为Node.js时，可直接调用：

```js
import { computeQuant, validateQuant } from './quant-module/src/models.mjs';

const validation = validateQuant(input);
if (!validation.valid) throw new Error(validation.errors.join('\n'));
const result = computeQuant(input, { marketData, before: 5, after: 5 });
```

其他语言的主后端可在内网调用量化HTTP服务。业务身份、数据期间、截止日、单位与字段来源一起传递，主服务负责账号、权限、持久化与供应商凭据。

独立服务默认绑定127.0.0.1，使用同源Origin检查。量化页面当前资源和接口采用根路径，集成到主站子路径时需统一调整资源前缀与路由。对外部署时由主后端接管鉴权和入口。

## 可审计研究过程

研究界面围绕计划、阶段状态、资料摘要、来源、参数确认、计算依据和冻结结果组织信息。输入或业务范围改变时重新确认相关基准；历史报告保留其保存时的输入、来源和计算身份。
