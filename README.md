# dsh-go-api-balance

给 **DSH Go 手机 App** 的原生「API 余额」面板：把任意 HTTP 接口的余额聚到一个面板里。
内置 6 种主流模板（DeepSeek、new-api / one-api 中转、OpenRouter、OpenAI / Claude 花费、OpenCode Go / Command Code、自定义），其余服务完全自定义——填地址、密钥和余额字段路径就行。

- **面板**：一家一块卡片（名称 / 状态 / 余额 / 两个大号用量指标 / 最多两条明细），点状态行右侧箭头展开菜单（编辑 / 删除 / 全部明细）；不同站货币不同，**不做总余额相加**。
- **用量**：每家服务可选配一个「用量」请求（中转站显示近 7 天 Token 数与请求数；OpenRouter 显示今日/本月花费）。
- **订阅**：new-api 站点会额外请求 `/api/subscription/self`，卡片上显示「订阅剩余 / 到期」，菜单里还有订阅总量与已用额度；没有订阅或旧站不支持时静默隐藏。
- **币种**：new-api / one-api 自动读站点 `/api/status`（`quota_per_unit`、自定义货币符号与汇率）；DeepSeek 按接口返回的 `currency`（CNY/USD）自动换符号。
- **鉴权**：Bearer 令牌、自定义请求头、Query 参数、Cookie、Basic、账号密码登录换 token。
- **模板**：内置 6 种，见下表；字段路径支持 `data.quota`、`balance_infos[0].total_balance`，也支持 `a + b`、`a - b` 这类简单算式。
- **凭证只在主机**：密钥写本机 `$DSH_HOME/cache/dsh-go-api-balance/config.json`（0600），只用于请求你配的余额接口；不进模型上下文、不写日志、不上传；面板里不回显密钥，只提示「已保存」。
- **只走 https**：余额/登录/用量/附加地址强制 https（本机 localhost 例外）；跨域跳转会被拦截，防止密钥被跳到第三方。详见 [SECURITY.md](SECURITY.md)。
- 零运行时依赖，运行时不读对话内容、不调模型。

## 安装

```sh
dsh plugin --profile web add dsh-go-api-balance
```

装在本机引擎（或 App 连的远程主机）上，App 的「插件」页签 / 全部功能里出现「API 余额」。
需要主机能访问你配的余额接口。

没上 npm 或国内下载慢时，也可以从 GitHub Release 下载同版本 tarball，或 clone 后本地安装：

```sh
git clone https://github.com/boyexquisite/dsh-go-api-balance.git
dsh plugin --profile web add ./dsh-go-api-balance
```

## 上手

1. 打开「API 余额」面板 → 「添加服务」→ 先选服务类型（只列 6 种常用的）。
2. 按类型填关键项：
   - **DeepSeek 官方**：只要 API Key（名称/接口/字段全自动）。
   - **new-api / one-api 中转**：先选站点类型（new-api 或 one-api 旧站），再填站点地址（`https://sta1n.ai` 或接入地址 `https://sta1n.ai/v1` 都行，`/v1` 会自动去掉）+ 系统访问令牌。余额、近 7 天用量、订阅都自动读；货币自动识别，无需手填。
   - **OpenRouter**：只填 API Key，显示余额和今日/本月花费。
   - **OpenAI / Claude 花费**：先选平台，再填组织 Admin key，只显示本月花费（不是余额）。
   - **OpenCode Go / Command Code**：先选平台，只填 API Key，显示订阅额度/剩余。
   - **自定义**：常用页签填地址/鉴权/密钥/余额路径，其余路径收在「高级」页签。
3. 保存后自动刷新，不用再点「刷新」；以后打开面板也会自动更新。

字段路径写法：`data.quota`、`balance_infos[0].total_balance`、`a[1].b`；简单算式也可以：`balance_infos[0].cash_balance + balance_infos[0].gift_balance`、`data.subscriptions[].subscription.amount_total - data.subscriptions[].subscription.amount_used`（订阅剩余）。

## 支持范围

### 内置模板（填对应 key / 令牌即可）

| 模板 | 显示内容 | 接口 | 凭证 |
|---|---|---|---|
| DeepSeek 官方 | 余额（自动 ¥/$）、卡片明细：充值余额、赠送余额 | `GET /user/balance` | API Key |
| new-api / one-api 中转 | new-api：余额、近 7 天 Token/请求、已用额度、累计请求、用户组、**订阅剩余/总量/已用/到期**；one-api 旧站：余额、近 7 天 Token/请求、已用额度、累计请求、用户组 | `/api/user/self` + `/api/data/self`（旧站 `/api/user/dashboard`）+ `/api/subscription/self` + `/api/status` | 系统访问令牌 |
| OpenRouter | 剩余额度（没设消费限额时显示 —）、今日/本月花费、本周花费、累计花费、消费限额与重置日期 | `/api/v1/key` | API Key |
| OpenAI / Claude 花费 | 本月花费（Claude 为官方估算值，不是余额）+ **本月输入/输出 Token、请求数**（Claude 另含缓存读/写 Token） | `/v1/organization/costs` + `/v1/organization/usage/completions` / `/v1/organizations/cost_report` + `/v1/organizations/usage_report/messages` | 组织 Admin key / Admin key |
| OpenCode Go / Command Code | OpenCode：5 小时窗口剩余 %、本周/本月剩余 %、各窗口重置日期；Command Code：本月剩余额度、5h/本周剩余金额与已用、重置时间 | `/zen/go/v1/usage` / `/alpha/billing/credits` | 各自 API Key |

### 用「自定义」能接、但没内置的

智谱 GLM（控制台内部接口，余额/充值/赠送/消费）、硅基流动（`/v1/user/info`，据公告 2026-08 已停服）、ModelScope 魔搭（魔粒余额）、MiniMax M Plan（`/v1/token_plan/remains`，字段未确认）、Ace Data（无余额 API）。这些接口不是官方公开文档或稳定性没保证，所以不让模板替你写死。

### 订阅类补充

- **OpenCode Go**：官方有 live usage 接口（`GET https://opencode.ai/zen/go/v1/usage`，Bearer），返回 5 小时 / 周 / 月三个窗口的已用百分比和重置时间；插件显示「剩余百分比」。
- **Command Code**：官方 CLI 用的计费路由（`GET https://api.commandcode.ai/alpha/billing/credits`，Bearer Provider API Key），返回月度剩余额度与 5h/周滚动窗口；这些 alpha 路由没有公开文档，站点改版可能失效，失效时插件会报错而不是显示错数。
- **OpenDesign**：只有网页 Cookie 方案（`amr-api.open-design.ai` 两次请求、要先取 workspace ID），没有 API key 鉴权；插件不支持两步请求，也不建议把账号 Cookie 存到手机插件里，所以不做。
- 这类「编码 Agent 订阅」的额度不是钱：OpenCode 是百分比，Command Code 是美元额度，插件按各自单位显示，不和余额相加。

### 明确不支持的

- **消费级订阅**（Claude Pro/Max、ChatGPT Plus、Gemini Advanced、Cursor、Perplexity Pro 等）：官方没有查询接口，且条款禁止自动化抓取；插件不做 cookie 方案。
- **没有余额/花费接口的平台**：Google Gemini 官方、Cohere、Groq、Replicate、HuggingFace、xAI（要 Management key + team_id，字段未确认）。
- **Claude / OpenAI 的预付费余额**：官方没有 API，只能看控制台；插件能显示的是 API 侧的「本月花费」。

> new-api / one-api 各站货币不同，插件优先自动识别；识别不到时回落到模板里填的符号/乘数。

## 安全与隐私

- 不读对话、剪贴板、其他文件；不调模型；没有遥测、没有后台轮询、零运行时依赖、无安装脚本。
- 请求只发往你填的服务地址；自动识别货币的 `/api/status` 不带密钥。
- 配置/缓存 0600、目录 0700，读到宽权限会自动收紧；密钥不进面板数据与缓存文件。
- 明文 `http://`（非本机回环）会被拒绝；跨域跳转直接停止。
- 能防的和防不住的（主机被入侵、供应链、恶意地址、Cookie 鉴权风险）都写在 [SECURITY.md](SECURITY.md)。

## 配置与缓存

- 配置：`$DSH_HOME/cache/dsh-go-api-balance/config.json`（0600）
- 余额缓存：`$DSH_HOME/cache/dsh-go-api-balance/results.json`（0600）
- 删掉配置即清空全部服务与密钥。

## 开发

```sh
npm test                                        # node:test，零依赖
node /root/.dsh/skills/dsh-go-plugin/kit/bin/check.mjs . --load
```

实现契约见 [`docs/spec.md`](docs/spec.md)。

## 许可

MIT
