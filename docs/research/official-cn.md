# 国内 AI 平台 / 中转站「余额 · 用量」接口调研

> task-14 · 2026-11-13 · research-cn
> 素材：官方文档 + GitHub 源码（new-api / one-api）+ 一次公开端点只读实测。
> **未使用任何真实密钥，未调用私有接口**；需鉴权的接口只按文档/源码记录，未实测。
> 用途：给 dsh-go-api-balance 选「可直接内建」的服务预设（GET + 鉴权 + JSON 路径 + divisor/multiplier + symbol + 用量路径）。

## 结论先行

**可直接加的内部预设（按易用度排序）**

1. **Moonshot / Kimi** —— 官方余额接口，字段干净，只差币种要按区域定（易）
2. **小米 MiMo** —— 2026-11-03 新上官方余额接口，字段最全（易）
3. **new-api 中转** —— 已有；`/api/user/self` + `/api/data/self` + 公开 `/api/status`（易）
4. **one-api 中转** —— `/api/status` 确实有（含 quota_per_unit），余额路径同 new-api；用量走 `/api/user/dashboard`（易/中）
5. **硅基流动 SiliconFlow** —— 官方文档仍给 `/v1/user/info`，但据公告 2026-08-14 起已停服，建议保留模板但先探活（中，风险）
6. **智谱 GLM** —— 控制台内部接口可查现金余额，非官方公开文档，可能变（中）
7. **ModelScope 魔搭** —— 魔粒余额端点，社区实测有效、官方文档未公开（中）
8. **MiniMax** —— 仅 M Plan 订阅账号的 `/v1/token_plan/remains`，返回字段未确认；按量余额无接口（中/未确认）

**不可行或未确认（一行带过）**：阿里云百炼、百度千帆、腾讯混元、火山引擎方舟、零一万物 Yi、Ace Data Cloud —— 要么只有云账号 AK/SK 签名的账单 OpenAPI（手机插件不该存 AK/SK），要么只有控制台。详见 §5。

---

## 1. 总表

| 平台 | 能查到什么 | 接口（方法 + URL） | 鉴权 | 返回字段（JSON 路径） | 适合做预设 | 官方文档 | 坑 |
|---|---|---|---|---|---|---|---|
| **DeepSeek**（已有） | 余额 | `GET https://api.deepseek.com/user/balance` | `Authorization: Bearer <API Key>` | `balance_infos[0].total_balance`、`.currency`、`.topped_up_balance`、`.granted_balance` | 易（已内置） | https://api-docs.deepseek.com/api/get-user-balance | 无用量接口 |
| **Moonshot Kimi** | 余额 | `GET https://api.moonshot.cn/v1/users/me/balance`（国内）<br>`GET https://api.moonshot.ai/v1/users/me/balance`（海外） | `Authorization: Bearer <API Key>` | `code`、`data.available_balance`、`data.voucher_balance`、`data.cash_balance` | **易** | [platform.kimi.ai/docs/api/balance](https://platform.kimi.ai/docs/api/balance) / [余额消耗查询](https://www.kimi.com/help/kimi-api/api-balance-and-usage) | 响应不返回币种：国内站 CNY、海外站 USD，按域名配 symbol；cash_balance 可为负（欠费）；无用量接口 |
| **小米 MiMo** | 余额（现金/赠金/冻结/授信） | `GET https://api.xiaomimimo.com/v1/platform/balance` | `api-key: <sk-...>` **或** `Authorization: Bearer <sk-...>`（官方两种都列） | `is_available`、`balance_infos[0].currency`、`.cash_balance`、`.gift_balance`、`.frozen_balance`、`.credit_limit`、`.credit_available`、`.total_available`（全是字符串） | **易** | [mimo.mi.com/docs/zh-CN/api/asset/balance-get](https://mimo.mi.com/docs/zh-CN/api/asset/balance-get) | 2026-11-03 才上线；`total_available` 含授信额度，不等于现金；套餐余量是另一套接口 |
| **智谱 GLM** | 现金余额/充值/赠送/消费/冻结 | `GET https://open.bigmodel.cn/api/biz/account/query-customer-account-report`（国内，另有 www.bigmodel.cn 同样路径）<br>`GET https://api.z.ai/api/biz/account/query-customer-account-report`（海外） | `Authorization: Bearer <API Key>` | `success`、`data.balance`、`data.availableBalance`、`data.rechargeAmount`、`data.giveAmount`、`data.totalSpendAmount`、`data.frozenBalance` | **中**（控制台内部接口） | 无官方 API 文档；社区实现：[glm-for-copilot/consts.ts](https://github.com/KiwiGaze/glm-for-copilot/blob/main/src/consts.ts)、[CodexBar #4796](https://github.com/steipete/CodexBar/issues/4796) | 非公开文档、无稳定性承诺；Coding Plan 额度是另一套 `/api/monitor/usage/quota/limit`；Token 资源包是 `/api/biz/tokenAccounts/list/my?pageNum=1&pageSize=100` |
| **阿里云百炼 DashScope** | 云账户余额（非 API Key 级） | 阿里云 BSS OpenAPI `QueryAccountBalance`（`bssopenapi` 2017-12-14，RPC 签名） | 阿里云 AK/SK + RAM 权限（HMAC 签名） | `Data.AvailableAmount`、`Data.Currency`、`Data.CreditAmount` 等 | **不可行** | [QueryAccountBalance](https://help.aliyun.com/zh/user-center/developer-reference/api-bssopenapi-2017-12-14-queryaccountbalance) | 插件要存 AccessKey/Secret 并自己实现签名；API Key 查不了余额，百炼控制台才有免费额度/用量 |
| **百度千帆** | 云账户余额 / Token Plan 额度 | 财务 API `billing.baidubce.com`（BCE AK/SK 签名）；Token Plan 只能控制台 Cookie | AK/SK 签名 / Cookie | 余额字段未逐项确认 | **不可行** | [财务 API 通用说明](https://cloud.baidu.com/doc/Finance/s/Sjxecy2pt) | 实名认证 + AK/SK；Cookie 方案会过期且不适合存手机插件 |
| **腾讯混元** | 云账户余额 | `DescribeAccountBalance`（`billing.tencentcloudapi.com`，Version `2018-07-09`） | 腾讯云 SecretId/SecretKey（TC3-HMAC-SHA256 签名） | 返回 Balance 等字段（未逐字段确认） | **不可行** | [DescribeAccountBalance](https://intl.cloud.tencent.com/ind/document/product/555/50284) | API Key 不行，必须云 API 密钥 + 签名 |
| **火山引擎豆包 Ark** | 账户余额 / 免费额度 / 套餐余量 | `QueryBalanceAcct`（`open.volcengineapi.com`，billing，Version `2022-01-01`）；CLI `arkcli usage balance` 同源 | 火山 AK/SK 签名 | `AvailableBalance`、`CashBalance`、`CreditLimit`、`FreezeAmount`、`ArrearsBalance`、`AccountID` | **不可行** | [QueryBalanceAcct](https://docs.volcengine.com/docs/billing-center/query-balance-acct-query-user-account-balance-information) / [用量与诊断](https://docs.volcengine.com/docs/ark/usage-and-diagnostics) | 同样是 AK/SK 签名；余额/用量/账单三种口径不能混 |
| **MiniMax** | M Plan 套餐余量 | `GET https://www.minimax.cn/v1/token_plan/remains`（按官方 FAQ，国内域名） | `Authorization: Bearer <API Key>`（需订阅 Key） | **返回字段未确认**（官方 FAQ 只给 curl） | **中/未确认** | [M Plan FAQ](https://platform.minimax.cn/docs/m-plan/faq) | 只对 M Plan 订阅账号有意义；按量付费账户余额无公开查询接口；有 5h/周双窗口语义 |
| **零一万物 Yi** | 控制台可见余额 | 未找到公开余额/用量 API | — | — | **不可行/未确认** | https://platform.lingyiwanwu.com/ | 官方文档未提供余额查询接口（未确认是否存在内部接口） |
| **硅基流动 SiliconFlow** | 余额（赠金/充值/总额） | `GET https://api.siliconflow.com/v1/user/info`（国际）<br>`GET https://api.siliconflow.cn/v1/user/info`（国内） | `Authorization: Bearer <API Key>` | `data.balance`、`data.chargeBalance`、`data.totalBalance`（均为字符串） | **中**（可能已下线） | [Get user info](https://docs.siliconflow.com/en/api-reference/userinfo/get-user-info) | 据社区转述的 2026-08-11 公告，`/user/info` 自 2026-08-14 停服、暂无替代（官方文档尚未更新）→ 预设要「先探活」；`balance` 与 `chargeBalance` 语义官方未明说，`totalBalance` 最稳 |
| **ModelScope 魔搭** | 魔粒余额 | `GET https://modelscope.cn/openapi/v1/magicubes/balance` | `Authorization: Bearer <访问令牌>` | `success`、`data.total_balance`、`data.available_balance`、`data.frozen_amount` | **中**（社区实测） | 官方 OpenAPI 未见该端点；实测记录：[SPIKE.md](https://github.com/eghrhegpe/dsh-connect-modelscope-token-plan/blob/HEAD/docs/SPIKE.md) | 只有余额快照、没有消费明细；魔粒 ≠ 人民币（symbol/倍率要用户填）；`frozen_amount` 是预扣 |
| **Ace Data Cloud** | 控制台 Credits（无 API） | 未提供余额 API；实测 `api.acedata.cloud/api/status` → 404 `no Route matched`、`/v1/balance` → 404 | — | — | **不可行/未确认** | https://docs.acedata.cloud/zh-Hans/faq/billing | 不是 new-api 站点（/api/status 不是它的路由）；计费单位是 Credits，文档只讲控制台与 `used_up` 错误 |
| **new-api 中转站** | 余额 + 已用额度 + 请求数 + 按天/模型用量 | `GET {base}/api/user/self`<br>`GET {base}/api/data/self?start_timestamp=&end_timestamp=&default_time=day`<br>公开：`GET {base}/api/status` | `Authorization: Bearer <系统访问令牌>`（用户鉴权）；`/api/status` 无鉴权 | 余额：`data.quota`、`data.used_quota`、`data.request_count`；用量：`data[]` 里 `model_name`、`created_at`、`token_used`、`count`、`quota`、`cache_read_tokens`、`cache_creation_tokens`；状态：见 §3 | **易**（已有） | 源码：[router](https://github.com/QuantumNous/new-api/blob/main/router/api-router.go)、[misc.go](https://github.com/QuantumNous/new-api/blob/main/controller/misc.go)、[user.go](https://github.com/QuantumNous/new-api/blob/main/controller/user.go)、[usedata.go](https://github.com/QuantumNous/new-api/blob/main/controller/usedata.go) | `quota` 是整数额度不是钱（默认 1 USD = 500000）；访问令牌是控制台「系统访问令牌」不是 sk- 推理 key；`/api/status` 可能被反代/CF 拦成 HTML |
| **one-api 中转站** | 余额 + 已用额度 + 请求数 + 近 7 天用量 | `GET {base}/api/user/self`<br>`GET {base}/api/user/dashboard`（近 7 天按天+模型）<br>公开：`GET {base}/api/status` | `Authorization: Bearer <访问令牌>` | 余额：`data.quota`、`data.used_quota`、`data.request_count`、`data.group`；dashboard：`data[].day`、`.model_name`、`.request_count`、`.quota`、`.prompt_tokens`、`.completion_tokens` | **易（余额）/中（用量）** | 源码：[v0.6.10 misc.go](https://github.com/songquanpeng/one-api/blob/v0.6.10/controller/misc.go)、[api.go 路由](https://github.com/songquanpeng/one-api/blob/v0.6.10/router/api.go)、[user.go](https://github.com/songquanpeng/one-api/blob/v0.6.10/controller/user.go)、[model/log.go](https://github.com/songquanpeng/one-api/blob/v0.6.10/model/log.go) | **没有 `/api/data/self`**；dashboard 固定「近 7 天」无时间参数；`/api/status` 缺 quota_display_type 等字段（§3） |

---

## 2. 值得直接落地的预设细节

### 2.1 Moonshot / Kimi（易）

- 请求：`GET {host}/v1/users/me/balance`，`Authorization: Bearer <sk-...>`
- 响应（官方字段表）：`{ "code": 0, "data": { "available_balance": 100.00, "voucher_balance": 10.00, "cash_balance": 90.00 } }`
- 建议草稿：
  - `balancePath='data.available_balance'`、`currencyPath` 无（API 不给币种）
  - `symbol='¥'`（`api.moonshot.cn`）/ `symbol='$'`（`api.moonshot.ai`）
  - `decimals=2`、`divisor=1`、`multiplier=1`
  - 明细：`代金券=data.voucher_balance`、`现金=data.cash_balance`
  - 用量：无（消耗明细在控制台 fee-detail 页）
- 坑：一个 Key 只属于一个区域；`cash_balance` 为负表示欠费。

### 2.2 小米 MiMo（易，最新）

- 请求：`GET https://api.xiaomimimo.com/v1/platform/balance`，头 `api-key: sk-...` 或 `Authorization: Bearer sk-...`
- 响应：`{ "object":"balance", "is_available":true, "balance_infos":[{ "currency":"CNY", "cash_balance":"100.50", "gift_balance":"20.00", "frozen_balance":"0.00", "credit_limit":"500.00", "credit_available":"380.00", "total_available":"500.50" }] }`
- 建议草稿：`balancePath='balance_infos[0].total_available'`、`currencyPath='balance_infos[0].currency'`、`decimals=2`、`divisor=1`
  - 明细：`现金=balance_infos[0].cash_balance`、`赠金=balance_infos[0].gift_balance`、`冻结=balance_infos[0].frozen_balance`
- 坑：字段全是字符串；`total_available` 包含授信可用额度；套餐余量（Token Plan）是另一套口径，本任务未确认其接口。

### 2.3 硅基流动 SiliconFlow（中，先探活）

- 请求：`GET https://api.siliconflow.com/v1/user/info`（国内 `https://api.siliconflow.cn/v1/user/info`），Bearer
- 响应：`data.balance`（字符串，如 `"0.88"`）、`data.chargeBalance`（充值余额）、`data.totalBalance`（总余额）
- 建议：`balancePath='data.totalBalance'`、`symbol='¥'`、`decimals=2`；明细 `赠金=data.balance`、`充值=data.chargeBalance`
- 坑：**据 2026-08-11 公告，`/user/info` 自 2026-08-14 起停止服务（官方文档未更新）**；上线时用「测试」按钮探活，404/410 提示用户平台已下线。

### 2.4 智谱 GLM（中，内部接口）

- 请求：`GET https://open.bigmodel.cn/api/biz/account/query-customer-account-report`，`Authorization: Bearer <API Key>`（海外 `https://api.z.ai` 同路径）
- 响应：`{ "success": true, "data": { "balance": ..., "availableBalance": ..., "rechargeAmount": ..., "giveAmount": ..., "totalSpendAmount": ..., "frozenBalance": ... } }`
- 建议：`balancePath='data.availableBalance'`（缺失时退 `data.balance`，插件只支持单路径→选 `availableBalance` 更稳，或做成 custom 由用户改）
  - 明细：`充值=data.rechargeAmount`、`赠送=data.giveAmount`、`已消费=data.totalSpendAmount`、`冻结=data.frozenBalance`
  - 币种：CNY（国内）/ USD（z.ai）
- 坑：**控制台内部接口，非公开文档**，随时可能改；Coding Plan 账号要另一套接口；Token 资源包另有 `/api/biz/tokenAccounts/list/my`。

### 2.5 ModelScope 魔搭（中，社区实测）

- 请求：`GET https://modelscope.cn/openapi/v1/magicubes/balance`，`Authorization: Bearer <访问令牌>`
- 响应：`{ "success": true, "data": { "total_balance": 143, "available_balance": 143, "frozen_amount": 0 } }`
- 建议：`balancePath='data.available_balance'`、`symbol='魔粒'`、`decimals=0`、`divisor=1`
- 坑：官方 OpenAPI 没有这个端点（社区 2026-10 实测），只给余额快照、无明细；单位是魔粒。

### 2.6 MiniMax（中/未确认）

- 请求：`GET https://www.minimax.cn/v1/token_plan/remains`，`Authorization: Bearer <API Key>`（官方 FAQ 写法）
- 返回字段：**未确认**，先不要写死路径；建议留成 custom 模板或加「探测后填」。
- 坑：仅 M Plan 订阅 Key 有效；按量计费账户的余额没有公开查询接口；5h + 周双窗口。

---

## 3. new-api / one-api 的 `/api/status` 与版本差异

### 3.1 `/api/status` 是否“普遍存在”

**都存在，且都是公开接口（不需要鉴权）。** 源码核对：

- new-api：`apiRouter.GET("/status", controller.GetStatus)` —— [router/api-router.go#L28](https://github.com/QuantumNous/new-api/blob/main/router/api-router.go)
- one-api：`apiRouter.GET("/status", controller.GetStatus)` —— [router/api.go#L17](https://github.com/songquanpeng/one-api/blob/v0.6.10/router/api.go)（v0.6.6 源码同样有）

实测（2026-11-13，只读公开接口）：`GET https://sta1n.ai/api/status` 返回 200 JSON，`data` 关键字段：

```json
{
  "quota_per_unit": 500000,
  "display_in_currency": true,
  "quota_display_type": "CUSTOM",
  "custom_currency_symbol": "🍪",
  "custom_currency_exchange_rate": 10,
  "usd_exchange_rate": 10,
  "price": 1,
  "system_name": "STA1N API"
}
```

说明「/api/status 带 quota_per_unit + 自定义货币」在真实 new-api 站上是常态，不是个例。

### 3.2 版本/字段矩阵

| 能力 | new-api 旧版（v0.7–v0.9 抽样） | new-api 新版（v1.0.0-rc.x，当前 rc.50） | one-api（v0.6.6–v0.6.10） |
|---|---|---|---|
| `GET /api/status` 公开 | ✅ | ✅ | ✅ |
| `data.quota_per_unit` | ✅ | ✅ | ✅ |
| `data.display_in_currency` | ✅ | ✅ | ✅ |
| `data.quota_display_type` | ❌（v0.9.0 源码无） | ✅ | ❌ |
| `data.custom_currency_symbol` / `custom_currency_exchange_rate` | ❌ | ✅ | ❌ |
| `data.usd_exchange_rate` | ❌（旧版未确认） | ✅ | ❌ |
| `GET /api/user/self` | ✅ `quota`/`used_quota`/`request_count` | ✅ 同左 + `permissions` 等 | ✅ 返回整个 user 对象（`quota`/`used_quota`/`request_count`/`group`） |
| `GET /api/data/self` 用量 | ✅ 数组：`model_name`/`created_at`/`token_used`/`count`/`quota` | ✅ 同左，另有 `cache_read_tokens`/`cache_creation_tokens` | ❌ **没有**；只有 `GET /api/user/dashboard`（固定近 7 天，按 `day`+`model_name` 聚合：`request_count`/`quota`/`prompt_tokens`/`completion_tokens`） |
| 余额单位 | `quota / 500000` USD | `quota / quota_per_unit` USD | `quota / 500000` USD（默认 `QuotaPerUnit=500000`） |
| 错误体 | `{success:false,message}` | 新版也见 `{code:"AUTH_UNAUTHORIZED",message,success:false}` | `{success:false,message}` |

> 版本判断技巧（建议写进实现）：`/api/status` 里有 `quota_display_type` → new-api 新版；只有 `quota_per_unit`+`display_in_currency` → one-api 或 new-api 旧版，此时**不要**去读 custom_currency_* 字段。

### 3.3 余额/用量接口的鉴权细节

- `Authorization: Bearer <系统访问令牌>`：
  - new-api：控制台「个人设置 → 系统访问令牌」（不是 `sk-` 推理 key）；`UserAuth` 同时兼容 Cookie 会话
  - one-api：控制台「设置 → 生成访问令牌」；`UserAuth` 会 `TrimPrefix("Bearer ")` 后校验
- `/api/status` 无鉴权，但可能被反代/Cloudflare 变成 HTML —— 探测失败不能当成站点不可用。

---

## 4. 兜底：`/api/status` 缺字段 / 拿不到时怎么办

**原则：`/api/status` 只用来「决定怎么换算」，永远不阻塞余额主流程。**

建议实现顺序（每步独立超时，2–5s）：

1. `GET {base}/api/status`（可选探测）
   - 200 + JSON + `data.quota_per_unit` → 记为 new-api/one-api 系，读取可用字段
   - 404 / HTML / 超时 → 标记「汇率未确认」，继续第 2 步
2. `GET {base}/api/user/self`，Bearer
   - 成功 → `balancePath='data.quota'`，按下面规则换算
   - 401 → 中文报错「访问令牌无效：请填控制台生成的系统访问令牌，不是 sk- 推理密钥」
   - 404 → 可能不是 new-api/one-api 站点，提示用户改自定义
3. 用量（可选）：`/api/data/self?...`；失败只降级为「只显示余额」，不要让整张卡变错误
   - 若 `/api/status` 明显是 one-api（无 quota_display_type）且 `/api/data/self` 404 → 改调 `/api/user/dashboard`（近 7 天）
4. 换算规则：

| 可用字段 | 换算 | symbol | 备注 |
|---|---|---|---|
| `quota_display_type='CUSTOM'` + `custom_currency_*` | `amount = quota / quota_per_unit * custom_currency_exchange_rate` | `custom_currency_symbol` | sta1n 实测 qpu=500000, rate=10, 🍪；推断 1 USD=10🍪 |
| `quota_display_type='USD'` | `amount = quota / quota_per_unit` | `$` | |
| `quota_display_type='CNY'` | `amount = quota / quota_per_unit`（再乘 `usd_exchange_rate` 的语义**未确认**，上线前与站点前端数值对照） | `¥` | 未逐行验证 |
| `quota_display_type='TOKENS'` | 直接显示 `quota` 原值（或另配 divisor），**不除 qpu** | `tokens`/空 | 未确认，建议实测 |
| 无 `quota_display_type`，`display_in_currency=true`（one-api/旧 new-api） | `amount = quota / quota_per_unit` | 用户可填，默认 `¥`（国内站） | 无法从 status 得知币种 |
| 无 `quota_display_type`，`display_in_currency=false` | 显示原始 `quota`，或仍按 USD 显示并注明 | `额度`/`$` | new-api 旧语义是按 token/额度显示 |
| 连 `quota_per_unit` 都没有 | 默认 **500000**（new-api/one-api 默认 `QuotaPerUnit`） | — | UI 标「按默认 500000 换算，可改」 |

5. 推荐增强（v1.5，属于实现层建议）：新增服务选「new-api/one-api」时先点「探测站点」→ 自动填 `divisor=quota_per_unit`、`symbol`、`multiplier=custom_currency_exchange_rate`；探测失败回退 `500000/¥/1`，不改用户已填值。

**再退一步（连 /api/status 也没有，例如被 CF 拦住）**：先按默认 `divisor=500000`+`symbol=¥` 显示余额，在卡片上加一个「汇率未确认」小字提示，用户可进高级页改 divisor/symbol；不要让用户因为探测失败而无法添加站点。

---

## 5. 不可行 / 未确认的细节（一行带过）

- **阿里云百炼 DashScope**：无 API Key 级余额接口；`QueryAccountBalance` 要阿里云 AK/SK 签名 + `bss:DescribeAcccount` 权限 → 手机插件不适合存 AK/SK，标不可行。
- **百度千帆**：财务 API `billing.baidubce.com` 要 BCE AK/SK 签名；Token Plan 额度只能控制台 Cookie → 不可行。
- **腾讯混元**：`DescribeAccountBalance` 要 SecretId/SecretKey + TC3 签名 → 不可行。
- **火山方舟 Ark**：`QueryBalanceAcct` 要 AK/SK 签名；`arkcli usage balance` 同样是云凭证 → 不可行。
- **零一万物 Yi**：未找到公开余额/用量 API，只有控制台 → 不可行/未确认。
- **Ace Data Cloud**：文档只有控制台 Credits 说明；实测 `api.acedata.cloud/api/status` 与 `/v1/balance` 均 404（`no Route matched`，不是 new-api 站点）→ 当前无公开余额接口，标未确认。

---

## 6. 建议落地顺序

1. 先加 **Kimi**、**MiMo**（纯官方、字段清晰、只填 Key 就能用）
2. **one-api** 预设补齐：余额同 new-api 路径；用量按 §4 降级到 `/api/user/dashboard`
3. **GLM** 以「自定义」形式内置默认值（URL/路径填好，标注内部接口风险）；**ModelScope** 同理
4. **SiliconFlow** 保留模板 + 探活提示；**MiniMax** 暂不内建，等返回字段确认
5. 百炼/千帆/混元/火山/Yi/Ace Data 不内建，文档里说明「需云账号 AK/SK / 仅控制台」

---

## 7. 参考链接

- Kimi 余额：https://platform.kimi.ai/docs/api/balance ；https://www.kimi.com/help/kimi-api/api-balance-and-usage
- 小米 MiMo 余额：https://mimo.mi.com/docs/zh-CN/api/asset/balance-get ；平台更新日志：https://mimo.mi.com/docs/zh-CN/updates/feature/platform
- 硅基流动 user/info：https://docs.siliconflow.com/en/api-reference/userinfo/get-user-info
- 智谱 GLM（社区实现）：https://github.com/KiwiGaze/glm-for-copilot/blob/main/src/consts.ts ；https://github.com/steipete/CodexBar/issues/4796
- ModelScope 魔粒（社区实测）：https://github.com/eghrhegpe/dsh-connect-modelscope-token-plan/blob/HEAD/docs/SPIKE.md
- MiniMax M Plan FAQ：https://platform.minimax.cn/docs/m-plan/faq
- 阿里云 BSS QueryAccountBalance：https://help.aliyun.com/zh/user-center/developer-reference/api-bssopenapi-2017-12-14-queryaccountbalance
- 百度云财务 API：https://cloud.baidu.com/doc/Finance/s/Sjxecy2pt
- 腾讯云 DescribeAccountBalance：https://intl.cloud.tencent.com/ind/document/product/555/50284
- 火山引擎 QueryBalanceAcct：https://docs.volcengine.com/docs/billing-center/query-balance-acct-query-user-account-balance-information
- Ace Data 计费 FAQ：https://docs.acedata.cloud/zh-Hans/faq/billing
- new-api 源码：https://github.com/QuantumNous/new-api （controller/misc.go、controller/user.go、controller/usedata.go、router/api-router.go）
- one-api 源码：https://github.com/songquanpeng/one-api/tree/v0.6.10 （controller/misc.go、controller/user.go、router/api.go、model/log.go）

---

## 2026-11-13 v2.0 修正

- **new-api 订阅**：`/api/user/self` 不返回 `subscription_quota`（STA1N 实测）；订阅在 `GET /api/subscription/self`，字段 `data.subscriptions[].subscription.amount_total/amount_used`（quota 单位）。插件已改为附加请求。
- **one-api 用量**：`GET /api/user/dashboard` 真实路由是 `/api/user/dashboard`（`selfRoute := userRoute.Group("/")`，`/dashboard` 与 `/self` 平级），固定近 7 天，字段 `request_count`/`quota`/`prompt_tokens`/`completion_tokens`。插件已拆出独立 one-api 预设。
- **小米 MiMo**：`total_available = cash_balance + gift_balance + credit_available`，含授信额度；插件余额改为 `cash + gift`，授信单列明细。
- **DeepSeek**：`currency` 可能是 `USD`（国际账号），插件按币种代码自动换 `$`。
