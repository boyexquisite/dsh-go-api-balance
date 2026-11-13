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

- 视图 `v: 2`；面板标题「API 余额」；总字节 ≤ 32 KiB、≤ 120 节点、≤ 8 层。
- 面板结构（自上而下）：
  1. 总余额 `metric`（值绑定 `data.total.text`，caption 绑定 `data.total.caption`；没有可汇总的服务时为 `'—'`）。
  2. 一行 `actions`：刷新、添加服务。
  3. 服务列表 `list`（绑定 `data.rows`：标题=名称，副标题=状态/更新时间，尾部=余额文本，tone 表示成功/失败）。
  4. 选择服务 `options`（绑定 `data.options`，`selected` 绑定 `data.selectedId`，动作 `select`）。
  5. 选中服务明细 `keyValue`（绑定 `data.detail.rows`）+ 错误 `callout`（`data.detail.error`）。
  6. 选中服务操作 `actions`：编辑、删除、测试。
  7. 表单（`form`，提交动作 `save`）：预设选择、名称、地址、方法、鉴权方式、密钥（`secret`）、用户名/登录地址（login 时）、余额字段路径、币种路径、明细路径（每行「标签=路径」多行文本）、除数、乘数、符号、小数位、额外请求头、请求体；`form` 里字段全部 bind 到 `data.form.*`；再加一个「取消」动作。
- 状态条：`data(scope, emit)` 推 `{ text, icon: 'wallet' }`，文本 ≤ 24 字，例如 `'余额 ¥1,234 · 3 家'`；`stripEnabled=false` 或没有结果时 `{ text: '' }`（App 不显示空文本）。
- 面板 `data`：首帧先推缓存（`results` 里有的），状态里 `busy` 为真时 caption 显示「更新中…」；后台刷新完再推一次。
- 交互（`lib/index.js` 的 `actions`）：
  - `refresh`：延后效果（`pending` label ≤16 字、timeoutMs=30000），`queryAll(enabled)` → 写 `results`、`saveResults`、推数据、`toast`「已更新 N 家」；`signal.aborted` 就停。
  - `select`：`event.value.value` 是 provider id → 设 `selectedId`，清空 `test`。
  - `add`：`form = 空白 custom 草稿`；`preset`：`event.value.value` 模板 id → 填草稿（保留用户已填的 name/url？v1 简单覆盖非密钥字段）。
  - `edit`：选中服务 → `providerToDraft`。
  - `save`：`event.value.values['data.form.<field>']` 取表单值组装 draft（以 `data.form` 为底，覆盖 form 里出现的字段），`validateProvider(draft, {existing})`；失败 `toast` 第一条错误；成功 upsert、保存配置、`form=null`、`selectedId=id`、`toast '已保存'`。
  - `delete`：选中 → 删除 + 存配置 + `toast '已删除'`。
  - `test`：延后效果，`queryProvider(selected, {preview:true})` → `test = { text, raw }`，`patch` 到 `data`。
  - `form-cancel`：`form=null`。
  - 所有 `actions` 的返回值/效果必须符合 bridge 白名单（`insert/copy/toast/patch/refresh/open/link/command`；延后结果只能 `insert/copy/toast/patch`）。
- 文案：中文优先，英文 `words(locale)` 给一份；`locale` 从 `caps.locale` 取（`startsWith('en')`）。

## 8. 安全与隐私

- `secret` 只出现在存储文件、请求头、内存；**不得**写进 `Result.rawPreview` 之外的 UI 文本、**不得**写日志、**不得**发给模型。
- 表单编辑时不回填真实密钥：`secret=''` + `secretSet=true`，placeholder「已保存，留空不改」。
- 面板数据里只放打码：`maskSecret`。
- `rawPreview` 只在用户点「测试」后由 `patch` 短暂出现在面板，≤ 8192 字符，不含请求头。
- 不在插件加载时联网；只在打开面板/点按后取数。
- 不读 `$DSH_HOME/sessions`、不读对话内容。

## 9. 测试要求

- core：路径解析、校验规则（逐字段非法/边界）、配置读写 0600 + 原子性 + 坏文件恢复、results 缓存、鉴权构造（6 种）、HTTP 错误映射、超时/取消、登录缓存与 401 重试、数值换算、预览截断。
- ui：`panelView` 的绑定路径必须都在 `panelData` 产出的数据里；面板字节/节点数上限；`formatAmount` 千分位/小数/符号/异常值；状态条 24 字上限；中英文案 key 齐全。
- 全部用 `node --test test/*.test.js` 跑；测试不联网。
- 总测试数目标 ≥ 60。

## 10. 验收

- `npm test` 全绿。
- `node /root/.dsh/skills/dsh-go-plugin/kit/bin/check.mjs . --load` 无 error。
- Lead 装到本机 `dsh plugin --profile web add .` 后，App 面板能打开、能加服务、能查到余额。
