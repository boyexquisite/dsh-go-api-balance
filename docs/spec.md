# dsh-go-api-balance · v1 实现规格（契约）

> 目标：DSH Go 手机 App 原生面板「API 余额」。面板里可添加/编辑任意「服务」（地址 + 鉴权 + 余额字段路径），
> 拉取并展示余额；内置 DeepSeek 官方与 new-api/one-api 中转两个模板，其余完全自定义。
> 凭证只写主机本地文件，不进模型上下文、不进日志、不上传。
>
> 本文是 core / ui 两条线共同遵守的契约。接口签名和字段名**不要改**；确需改动先发消息给 Lead。

## 0. 非目标（v1 不做）

- 不做网页版 / 桌面端插件（只做 dsh-go App 原生面板 + 状态条）。
- 不做余额历史曲线、消费趋势、告警、定时推送。
- 不做 OAuth、不解析网页 HTML（只认 JSON 接口）。
- 不读剪贴板、不读对话内容、不调模型；不依赖任何 npm 包（零运行时依赖）。

## 1. 目录与所有权

| 文件 | 负责人 | 说明 |
|---|---|---|
| `lib/extract.js` `lib/config.js` `lib/presets.js` `lib/query.js` | core | 数据层，纯函数 + fs/网络，可单测 |
| `test/config.test.js` `test/extract.test.js` `test/query.test.js` `test/presets.test.js` | core | `node --test` |
| `lib/format.js` `lib/view.js` `lib/index.js` | ui | 展示层、面板数据、注册与点按处理 |
| `test/view.test.js` `test/format.test.js` | ui | 结构/文案/上限测试 |
| `package.json` `cordis.patch.yml` `README*` `docs/` `scripts/` `.github/` | Lead | 清单与发布 |

- 只改自己负责的文件；不要动别人文件、不要动 `package.json`（改清单先告诉 Lead）。
- 语言：UI 文案中文为主、英文在 `words()` 里给一份；给用户看的报错必须是**人话中文**（不出现 `TypeError: fetch failed` 之类）。
- 代码风格：`export function` / `export const`，`type: module`，缩进 2 空格，单引号，无分号行尾（跟 token-usage 插件一致）。
- 测试用 `node:test` + `node:assert/strict`；网络全部通过注入的 `fetchImpl` mock，测试不联网、不写真实 `$DSH_HOME`（用临时目录）。

## 2. 存储（`lib/config.js`）

`$DSH_HOME` = `process.env.DSH_HOME`（非空）否则 `path.join(os.homedir(), '.dsh')`。

- 配置：`$DSH_HOME/cache/dsh-go-api-balance/config.json`
- 结果缓存：`$DSH_HOME/cache/dsh-go-api-balance/results.json`
- 两者都以 **0600** 权限、原子写（同目录临时文件 `fs.writeFile(tmp, data, {mode:0o600})` → `fs.rename`）。
- 目录不存在自动 `mkdir -p`（递归、`mode: 0o700`）。
- 配置读取失败（JSON 坏 / 版本不认）→ 改名备份为 `config.json.bad-<timestamp>`，返回默认配置，不抛给 UI。
- 导出：

```js
export const CONFIG_VERSION = 1
export const RESULTS_VERSION = 1

export function resolveHome(env = process.env)                 // string
export function configDir(home = resolveHome())                // string
export function configPath(home = resolveHome())               // string
export function resultsPath(home = resolveHome())              // string
export function defaultConfig()                                // Config
export function defaultSettings()                              // Settings
export function newProviderId(now = Date.now, rand = Math.random) // 'p_'+8 位 base36

export async function loadConfig(file = configPath())          // Promise<Config>
export async function saveConfig(config, file = configPath())  // Promise<void>，写前 normalize
export async function loadResults(file = resultsPath())        // Promise<{v:1, results:{}}>
export async function saveResults(results, file = resultsPath()) // Promise<void>

export function validateProvider(draft, { existing = null } = {})
// → { ok: true, provider } | { ok: false, errors: { [field]: '中文错误' } }
export function maskSecret(secret)                             // '••••' + 末 4 位；≤8 位时 '••••'
export function providerToDraft(provider)                      // form 用：secret 不带出来（见 §5）
```

### 2.1 Config

```js
{
  v: 1,
  providers: [Provider, ...],          // ≤ 24
  settings: {
    stripEnabled: true,                // 输入框上方状态条
    refreshOnOpen: true,               // 打开面板时自动刷新
    timeoutMs: 12000,                  // 单次请求超时，4000..30000
  }
}
```

### 2.2 Provider（存储结构，所有字段必存）

| 字段 | 类型 | 规则 / 默认 |
|---|---|---|
| `id` | string | `^p_[a-z0-9]{6,12}$`；新建时生成；编辑保留 |
| `name` | string | trim 后 1–24 字；必填 |
| `preset` | `'custom'\|'deepseek'\|'newapi'` | 默认 `custom` |
| `url` | string | 必填，`http://` 或 `https://`，≤ 2048 字符 |
| `method` | `'GET'\|'POST'` | 默认 `GET` |
| `authType` | `'bearer'\|'header'\|'query'\|'cookie'\|'basic'\|'login'` | 默认 `bearer` |
| `secret` | string | 鉴权值；除 `cookie` 外 trim；≤ 2048；见下 |
| `secretHeader` | string | `authType=header` 时用；默认 `'X-API-Key'`，≤ 64 |
| `secretParam` | string | `authType=query` 时用；默认 `'key'`，≤ 64 |
| `username` | string | `basic` / `login` 必填；≤ 128 |
| `loginUrl` | string | `authType=login` 必填，http(s)；≤ 2048 |
| `tokenPath` | string | `authType=login` 时取 token 的路径；默认 `'data.token'` |
| `tokenHeader` | string | `login` 取到 token 后放哪个头；默认 `'Authorization'`；值为 `tokenPrefix + token` |
| `tokenPrefix` | string | 默认 `'Bearer '`；≤ 32 |
| `headersText` | string | 额外请求头 JSON 文本；空串=无；≤ 4096；必须是 JSON 对象 |
| `bodyText` | string | POST 请求体 JSON 文本；空串=无；≤ 4096；必须是 JSON（对象/数组） |
| `balancePath` | string | 必填，JSON 取值路径（§4） |
| `currencyPath` | string | 可选；取币种代码（如 `CNY`） |
| `detailPaths` | `[{label,path}]` | ≤ 6 项；label 1–20 字；path 合法 |
| `divisor` | number | > 0；默认 1；0.000001..1e12 |
| `multiplier` | number | > 0；默认 1；0.000001..1e12 |
| `symbol` | string | 显示货币符号；≤ 8；默认 `'¥'`；可空 |
| `decimals` | integer | 0–4；默认 2 |
| `enabled` | boolean | 默认 true |

`validateProvider` 的规则：

- 未知字段丢弃（白名单重建对象）；数字字符串（表单来的）转 number；`decimals` 取整。
- `secret` 规则：
  - `bearer` / `header` / `query` / `cookie` / `basic`（password）：新建必填；编辑时若 `existing` 存在且传入的 `secret` 为**空串**，沿用 `existing.secret`（表单「留空=不改」）。
  - `login`：password 同上；另须 `username`、`loginUrl`。
  - `cookie` 允许 `;` `=` 等字符，只 trim 两端空白。
- 错误信息中文（示例）：`'请填名称'` `'地址要以 http:// 或 https:// 开头'` `'请填密钥/令牌'` `'余额字段路径不合法'` `'额外请求头要是 JSON 对象'` `'超时时间要在 4–30 秒之间'`。
- `maskSecret('sk-abcdef123456')` → `'••••3456'`；长度 ≤ 8 → `'••••'`。
- `providerToDraft(provider)` → 给表单的草稿：复制全部字段，但 `secret: ''`，另加 `secretSet: true`（UI 据此决定密钥框 placeholder 和是否必填）。

### 2.3 Results 缓存

```js
{ v: 1, results: { [providerId]: Result } }
```

读取时丢弃坏项；写失败不抛给 UI（缓存是加速，不是真相）。

## 3. Result（运行时，`lib/query.js`）

```js
{
  id: string,
  ok: boolean,
  balance: number | null,        // 原始数值（未乘除），失败为 null
  currency: string,              // currencyPath 取到的，或 provider.symbol
  symbol: string,
  decimals: number,
  details: [{ label: string, value: number|string|null }],  // 按 detailPaths 取，取不到 null
  rawPreview: string | null,     // 仅 preview=true 时给，JSON 文本，≤ 8192 字符
  error: string | null,          // 中文人话
  fetchedAt: number,             // epoch ms
}
```

`formatAmount(provider, value)`（在 `lib/format.js`，UI 线）→ 显示文本：`symbol` + 千分位 + `decimals` 位小数；`symbol` 为空则纯数字；非有限值返回 `'—'`。

## 4. 路径语法（`lib/extract.js`）

- 支持点号与下标：`data.quota`、`balance_infos[0].total_balance`、`a[1].b`。
- 允许前缀 `$.`（去掉）。数组下标只能是非负整数。路径 ≤ 256 字符。
- `getByPath(obj, path)` → 命中返回值（可能是 `null`），未命中/非法返回 `undefined`；**不抛异常**。
- `validatePath(path)` → boolean（合法：`^[A-Za-z_$][\w$]*(\[\d+\]|\.[A-Za-z_$][\w$]*)*$`，允许 `$.` 前缀）。
- `pickNumber(value)` → 数字或 null：`number` 有限值直接要；字符串 trim 后能 `Number()` 且有限；否则 null。

## 5. 取数（`lib/query.js`）

```js
export function createRunner({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  defaultTimeoutMs = 12000,
} = {}) // → { queryProvider, queryAll, clearTokenCache }

export async function queryProvider(provider, { signal, timeoutMs, preview = false } = {})
// → Promise<Result>；绝不抛异常，所有失败都落到 Result.ok=false + error

export async function queryAll(providers, { signal, timeoutMs, preview = false, limit = 3 } = {})
// → Promise<Result[]>；按传入顺序返回；并发 ≤ limit；单家失败不影响别家
```

- 请求构造：
  - `url` 按 `authType` 拼鉴权：`query` 用 `?<secretParam>=<secret>`（URLSearchParams 合并，注意保留已有 query）。
  - 请求头：先 `headersText` 里头的 JSON 对象，再按 `authType` 覆盖：`bearer` → `Authorization: Bearer <secret>`；`header` → `<secretHeader>: <secret>`；`cookie` → `Cookie: <secret>`；`basic` → `Authorization: Basic base64(user:pass)`（UTF-8 安全）；`login` → `<tokenHeader>: <tokenPrefix><token>`。
  - `method === 'POST'` 且 `bodyText` 非空：body=bodyText，若用户没显式给 `Content-Type` 则 `application/json`。
  - 一律带 `Accept: application/json`（用户显式给就以用户为准）。
- 超时：用 `AbortController` + 定时器（`timeoutMs`）；外部 `signal` 也接（任一触发即取消），完成后清定时器。绝不留下悬挂 timer。
- 响应：读文本（≤ 256 KiB，超了截断）；非 2xx 映射成中文错误；JSON 解析失败 → `'返回的不是 JSON'`；`balancePath` 取不到 → `'解析不到余额字段，检查取值路径'`；数值解析失败 → `'余额不是数字'`。
- HTTP 映射：401 `'密钥或令牌无效'`、403 `'没有权限访问这个接口'`、404 `'接口不存在，检查地址'`、429 `'请求太频繁，稍后再试'`、5xx `'对方服务出错（HTTP n）'`、网络异常 `'连不上接口，检查地址或网络'`、超时 `'请求超时'`、取消 `'已取消'`。
- `currency`：`currencyPath` 命中且是字符串则用；否则用 `provider.symbol`。
- `details`：每条 `detailPaths` 取值，取不到 `null`。
- `login` 鉴权：token 缓存在 runner 内 `Map`（key=provider.id+loginUrl+username）；没有缓存则 POST `loginUrl`（JSON `{username,password}`，`Content-Type: application/json`），必须 2xx 且 `tokenPath` 取到非空字符串，否则 `'登录失败，检查账号密码'`；主请求返回 401/403 时清缓存重试一次。
- `balance`：`pickNumber(getByPath(json, balancePath))`；`null` → 失败。
- `rawPreview`：仅 `preview` 时给，`JSON.stringify(json)` 截前 8192 字符。
- `fetchedAt` 用注入的 `now()`。

## 6. 模板（`lib/presets.js`）

```js
export const PRESETS = [
  { id: 'deepseek', label: 'DeepSeek 官方', icon: 'deepseek'? （不用 icon） },
  { id: 'newapi', label: 'new-api / one-api 中转' },
]
export function presetDraft(presetId, { base = '', token = '', rate = 1 } = {})
// → 表单草稿（含 preset、name、url、authType、balancePath、currencyPath、detailPaths、
//    divisor、multiplier、symbol、decimals；secret/username 由用户填）
export function presetOptions() // → [{ label, value }] 给 UI 选项（含 custom「自定义」）
```

- `deepseek`：`https://api.deepseek.com/user/balance`，GET，bearer，`balancePath='balance_infos[0].total_balance'`，`currencyPath='balance_infos[0].currency'`，明细 `充值余额 balance_infos[0].topped_up_balance`、`赠送余额 balance_infos[0].granted_balance`，`symbol='¥'`，`decimals=2`，name=`'DeepSeek'`。
- `newapi`：`base` 去掉尾部 `/` 后拼 `/api/user/self`（base 空则留空让用户填），GET，bearer，`balancePath='data.quota'`，`divisor=500000`，`multiplier=rate`（默认 1），`symbol='¥'`，`decimals=2`，name=`'new-api 中转'`，明细 `已用额度 data.used_quota`。
- `custom`：全空白草稿（`preset='custom'`, `symbol='¥'`, `decimals=2`, `divisor=1`, `multiplier=1`）。

## 7. 展示层（`lib/view.js` + `lib/format.js` + `lib/index.js`）

> recon（docs/recon.md）确认的平台事实，按此实现：
> - 视图根节点 `v: 2`、`accent: 'app'`；清单 `dshGo.v` 仍为 `1`；**不写 `minApp`**；
>   老 App 用 `caps.components` 判断，缺 `form`/`textField` 等时退成 v1 只读摘要 + 升级提示。
> - `options` 组件上限 8 项，**服务列表用 `list` 行内 action**（`items` 绑 `data.rows`，行里放 `action:{id:'select',args:{id}}`）。
> - `panel` 的 `actions` 支持延后效果；`pending.label ≤16 字`、`timeoutMs=30000`；延后结果只能用 `patch`/`toast`/`copy`/`insert`。
> - patch 是 RFC 7386（数组整体替换、`null` 删除、≤16 KiB），数据整份 ≤32 KiB；**数据对象每次都传新对象**。
> - 面板 GET 最多等 1 秒首帧：`data()` 先同步 emit 缓存，再后台刷新；`strip` 的 data 常驻，**只读缓存、绝不联网**。
> - 结构随状态变化（表单展开/收起、测试结果、删除确认）时，视图函数闭包读状态，状态变后调 `ctx.dshGo.refresh('balance')`。

- 面板结构（自上而下，条件块按状态出现）：
  1. 总余额 `metric`（值 `data.total.text`，caption `data.total.caption`；没有可汇总值为 `'—'`）。
  2. 一行 `actions`：刷新、添加服务。
  3. 服务列表 `list`（`items: {$:'data.rows'}`）：行 = `{ title, subtitle, trailing, tone, action:{id:'select',args:{id}} }`；没有服务时用一行 `emptyState`/`callout` 引导添加。
  4. 选中服务：`keyValue`（`data.detail.rows`）+ `callout`（`data.detail.error`）+ `actions`「编辑 / 删除」。
  5. 删除确认（`data.confirmDelete` 存在时）：`callout` + `confirm`（动作 `delete`，`event.value.confirmed`）。
  6. 测试结果（`data.test` 存在时）：`codeBlock`（`data.test.raw`）+ `actions`「关闭」。
  7. 服务表单（`data.formOpen` 时）：`form`（提交动作 `save`）内放 `tabs` 三组：基本信息 / 鉴权 / 字段与显示；表单外「取消」动作。
- 表单字段（`bind` 全部为 `data.form.<字段>`，同一视图内不重复）：
  `preset`(select 3 项) `name` `url` `method`(select) `authType`(select 6 项) `secret` `secretHeader` `secretParam` `username` `loginUrl` `tokenPath` `tokenHeader` `tokenPrefix` `balancePath` `currencyPath` `detailText`（每行 `标签=路径`）`divisor`(number) `multiplier`(number) `symbol` `decimals`(stepper 0..4) `headersText`(multiline) `bodyText`(multiline) `enabled`(toggle)。
- **4 KiB 提交预算**（App 硬上限）：视图 `maxLength` 收紧为 `url 512`、`secret 768`、`headersText 256`、`bodyText 256`、`detailText 384`、`loginUrl 512`、`balancePath/currencyPath 120`、`name 24`、`username 100`、`tokenPath 120`、`tokenHeader 64`、`tokenPrefix 32`、`secretHeader 64`、`secretParam 64`、`symbol 8`；单测按最坏情况填满断言 `Buffer.byteLength(JSON.stringify(values)) < 4096`。core 校验仍按 §2 接受文件里更长的值。
- 视图预算：整树 JSON ≤32 KiB、节点 ≤120、深度 ≤8、单个 `stack`/`row` 直接孩子 ≤32、`tabs` ≤8 项、`list` ≤50 行、`keyValue` ≤24 项、`actions` ≤4 个。
- `select` 动作：`event.value.id` → 设为 `selectedId`，清 `test`/`confirmDelete`，`patch` 数据（或 emit）并 `refresh` 视图（结构可能变化）。
- `refresh`：延后效果，`queryAll(enabled,{signal})` → 写 `results`、`saveResults`、更新数据、`toast '已更新 N 家'`；`signal.aborted` 立即返回 `{}`。
- `test`：延后效果，`queryProvider(selected,{preview:true})`；**先把 `rawPreview` 里的 `provider.secret` / `username` 原文替换成 `'••••'` 再 patch**；`toast` 不带密钥/URL query。
- `add` / `edit`：`formOpen=true` + 填 `data.form`（`edit` 用 `providerToDraft`，secret 留空、`secretSet=true`），`refresh`。`form-cancel`：`formOpen=false`，`refresh`。
- `save`：从 `event.value.values` 按完整 bind 路径取字段（key 形如 `'data.form.name'`），以当前 form 草稿为底组装 draft，`validateProvider(draft,{existing})`；失败 `toast` 第一条中文错误；成功 upsert + `saveConfig` + `selectedId=id` + `formOpen=false` + `refresh` + `toast '已保存'`。
- `preset`：`select` 的 `onChange`（`{bind,value}`，250ms 合并，只能返回 patch/refresh）或独立动作填模板字段；保留已填的 name/url 不覆盖（除非为空）。
- `delete`：`confirm` 组件（`confirmDelete` 状态）→ `event.value.confirmed` 为 true 才删；删后清状态、`saveConfig`、`refresh`、`toast '已删除'`。
- 状态条：`{ text, icon: 'wallet' }`，≤24 字，例如 `'余额 ¥1,234 · 3 家'`；`stripEnabled=false` 或没有结果 → `{ text: '' }`。
- 文案：中文优先，`words(locale)` 给英文；`locale` 取 `caps.locale`（`startsWith('en')`）。
- `apply(ctx, options = {})`：`options.home/fetchImpl/now` 透传（测试用），见 §7.1。

## 8. 安全与隐私

- `secret` 只出现在存储文件、请求头、内存；**不写日志、不发模型、不放进视图/数据/效果文本**。
- 面板与表单**不回显任何密钥**：`data.form.secret` 恒为空串；编辑时只给 `secretSet:true`（视图 placeholder「已保存，留空不改」）；不把 `maskSecret` 结果放进数据/视图（README 只写「不显示密钥」）。
- `rawPreview`：只在用户点「测试」后出现，≤8192 字符；patch 前把 `provider.secret`、`username` 的原文替换成 `'••••'`（含 `Bearer <token>` 里的 token 子串）。
- 错误文案/URL/toast 不得带 query 里的密钥；`authType=query` 的 URL 不进任何 UI 文本。
- 不在插件加载时联网；只在打开面板/点按后取数；`strip` 不联网。
- 不读 `$DSH_HOME/sessions`、不读对话内容、不读剪贴板。
- 配置目录 0700、文件 0600、原子写（§2）。

## 9. 测试要求

- core：路径解析、校验规则（逐字段非法/边界）、配置读写 0600 + 原子性 + 坏文件恢复、results 缓存、鉴权构造（6 种）、HTTP 错误映射、超时/取消、登录缓存与 401 重试、数值换算、预览截断。
- ui：`panelView` 的绑定路径必须都在 `panelData` 产出的数据里；面板字节/节点数上限；`formatAmount` 千分位/小数/符号/异常值；状态条 24 字上限；中英文案 key 齐全。
- 全部用 `node --test test/*.test.js` 跑；测试不联网。
- 总测试数目标 ≥ 60。

## 10. 验收

- `npm test` 全绿。
- `node /root/.dsh/skills/dsh-go-plugin/kit/bin/check.mjs . --load` 无 error。
- Lead 装到本机 `dsh plugin --profile web add .` 后，App 面板能打开、能加服务、能查到余额。

## 11. v1.1：每家服务的「用量」（API usage）

> 哥哥 2026-11-13 追加要求：余额面板里显示每家服务自己的用量（Token 数/请求数）。
> DeepSeek 官方 API 只有余额、没有用量接口，**本期只给中转站/自定义服务加**，DeepSeek 保持余额。

### 11.1 Provider 新增可选字段（全部可空；空 = 不查用量）

| 字段 | 类型 | 规则 / 默认 |
|---|---|---|
| `usageUrl` | string | ≤512（表单 maxLength 300）；`http(s)` 开头；支持占位符 `{now}`（当前 epoch 秒）、`{today}`（本地当天 00:00 epoch 秒）、`{7d}`（now-7×86400） |
| `usageMethod` | `'GET'\|'POST'` | 默认 `GET` |
| `usageArrayPath` | string | ≤120（表单 40）；JSON 路径；空 = 自动（响应是数组用它，否则取 `data` 数组，再否则第一个数组） |
| `usageFields` | `[{label, path}]` | ≤4 项；label 1–20 字；path 合法；对数组每项按 path 取数**求和**，标量则直接取 |
| `usageScale` | boolean | 默认 false；true = 数值按 provider 的 divisor/multiplier/symbol 格式化（额度类），false = 原始计数（Token/请求数） |
| `usageFieldsText` | 仅表单用（不落盘） | 每行 `标签=路径`，最多 4 行；保存时解析成 `usageFields` |
| `usageHeadersText` | 暂不做（v1.1 不新增独立鉴权；用量请求复用 provider 鉴权） | — |

校验：填了 `usageUrl` 就必须至少 1 个 `usageFields`，否则中文报错「填了用量地址就要填用量字段」；
`usageUrl` 非空时按 http(s) 校验，其余不填即忽略。

### 11.2 取数（`lib/query.js`）

- `queryProvider` 在余额请求完成后（余额成功或失败都行）若 `usageUrl` 非空，再发一次用量请求：
  - URL 占位符替换（本地时区）；鉴权与余额请求相同（Bearer/Header/Query/Cookie/Basic/Login token 缓存复用）。
  - JSON 解析后按 §11.1 取数组、逐字段求和；取不到/非数字 → 该字段省略。
  - 用量失败（HTTP/网络/解析）**不污染 Result**：`usage = []`，不写 error、不上抛；超时/取消同样静默。
  - 每次请求都独立超时（同一 timeoutMs）。
- Result 新增 `usage: [{ label, value }]`（value 有限数字；≤4 项；失败为空数组）。
- 新增导出 `resolveUsageUrl(provider, now)`（纯函数，测试用）：替换占位符。

### 11.3 模板（`lib/presets.js`）

- `newapi` 追加：
  - `usageUrl = '<base>/api/data/self?start_timestamp={7d}&end_timestamp={now}&default_time=day'`
  - `usageArrayPath = 'data'`
  - `usageFields = [{label:'近7天 Token', path:'token_used'}, {label:'近7天 请求', path:'count'}]`
  - `usageScale = false`
  - 实测 STA1N：34 条桶求和 = Token 1554060713、请求 6837（2026-11-13 验证）。
- `deepseek` / `custom`：不填 usage（空）。

### 11.4 展示（`lib/view.js` / `lib/format.js` / `lib/index.js`）

- 列表行副标题：`成功 · 09:25 · 近7天 Token 1.55亿 · 近7天 请求 6,837`——把 `result.usage` 的 `text` 用 ` · ` 拼在状态/时间后面，最多 2 项、整行 ≤ 60 字（超出截断加 `…`）；没有 usage 时保持现状。
- 用量数值格式（`lib/format.js` 新增 `formatUsage(provider, field)`）：
  - `usageScale=true` → `formatAmount(provider, value)`；
  - 否则 → 原始计数千分位；≥1e8 用「亿」、≥1e4 用「万」（英文用 B/M/K），保留 1 位小数。
- 表单新增第 4 个页签「用量」：`usageUrl`、`usageArrayPath`、`usageFieldsText`（multiline）、`usageScale`（toggle）；不改变其它页签。
- 表单 maxLength 相应收紧（保证最坏提交 <4096B）：`url 400`、`loginUrl 300`、`secret 600`、`username 80`、`tokenPath 80`、`tokenHeader 48`、`tokenPrefix 24`、`secretHeader 48`、`secretParam 48`、`balancePath 100`、`currencyPath 80`、`headersText 200`、`bodyText 200`、`detailText 300`、`usageUrl 300`、`usageArrayPath 40`、`usageFieldsText 120`；单测按最坏情况填满断言 <4096。
- `lib/index.js` 的 `save`：`usageFieldsText` 解析（每行 `标签=路径`，≤4）写入 `usageFields`；其余字段按现有逻辑透传。
- 详情区块不变（仍只放 `result.details`）；错误/预算/v1 降级不变。

## 12. v1.2：模板向导（表单「不知道怎么填」的解法）

> 哥哥 2026-11-13 反馈：字段太多、JSON 路径不知道咋填。改成**先选服务类型，再只填关键项**；
> 高级字段只在「自定义」里出现，且收进「高级」页签。core（config/query/presets）不改。

### 12.1 添加入口

- 「添加服务」不再直接开大表单，先进入「选择服务类型」：`list` 三行（`action:{id:'choose-template',args:{preset}}`）：
  - `DeepSeek 官方` —— 副标题「只填 API Key，余额自动读」
  - `new-api / one-api 中转` —— 副标题「填站点地址和访问令牌，余额/用量自动读」
  - `自定义` —— 副标题「自己的接口，需要填地址和字段路径」
- 选完才出对应表单；表单上方给一行 caption 写明自动配置了什么（如「自动：/user/balance · 只显示余额」）。
- 面板状态新增 `pickTemplate: boolean`；`add` → `pickTemplate=true`；`choose-template` → `form = presetDraft(preset)`、`pickTemplate=false`、`formOpen=true`；`form-cancel` 清两者。

### 12.2 模板表单（只显示关键字段）

- **DeepSeek**：名称（默认「DeepSeek」）、密钥（`secret`，编辑时留空=不改，placeholder「已保存，留空不改」）。其它字段全部隐藏，保存时由模板固定（url/路径/明细）。
- **new-api / one-api**：名称（默认「new-api 中转」）、站点地址（表单字段 `siteBase`，如 `https://sta1n.ai`）、访问令牌（`secret`）、货币符号（`symbol`，默认 ¥）、乘数（`multiplier`，默认 1；说明「额度 ÷500000 × 乘数」）。隐藏 url/usage 路径。
  - 保存时 `siteBase` 必填 http(s)；`url = siteBase + '/api/user/self'`；`usageUrl = siteBase + '/api/data/self?start_timestamp={7d}&end_timestamp={now}&default_time=day'`；`usageArrayPath='data'`；`usageFields` 用模板默认（`近7天 Token=token_used`、`近7天 请求=count`）；`usageScale=false`。
  - 编辑已有 newapi 服务：从 `provider.url` 反推 siteBase（去掉 `/api/user/self`；去不掉就原样显示，用户可改）。
- **自定义**：两页签 `常用` / `高级`：
  - 常用：名称、地址、方法、鉴权方式、密钥（及该鉴权需要的 username/header 名/param 名/登录地址等）、余额字段路径（必填，hint「点保存后可回来改；或按原始 JSON 对照」）、货币符号。
  - 高级：币种路径、明细字段、除数、乘数、小数位、额外请求头、请求体、用量地址、用量数组路径、用量字段、用量换算开关。
  - 保持现有表单上限与 4 KiB 断言；`usageFieldsText` 解析逻辑不变。

### 12.3 交互细节

- `siteBase` 是表单专用字段（不落盘），`panelData.form` 里带 `siteBase`；`providerForm` 反推；`emptyForm` 置空。
- `save`：按 `base.preset` 分支（deepseek/newapi/custom）组装 draft 后走现有 `validateProvider`；模板分支里若名称为空用默认名。
- 保存成功后自动触发一次后台刷新（`startBackgroundRefresh()` 风格），不用用户再点「刷新」。
- 移除表单里的「内置模板」select 与 `preset` onChange 动作（避免 patch 不刷新可见值的坑）；模板只能在添加时选。
- 视图预算、绑定路径、v1 降级、删除确认、测试动作等其余行为不变；tests 同步更新。
