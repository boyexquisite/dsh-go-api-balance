# 国际平台官方 API：余额 / 用量 / 额度接口调研

调研时间：2026-11-13。范围：OpenAI、Anthropic Claude、Google Gemini（含 Vertex）、xAI Grok、Mistral、Cohere、Groq、Together、Fireworks、Perplexity、OpenRouter、Replicate、HuggingFace。
方法：只查官方文档（docs 域名）；不碰任何真实密钥、不访问文档以外站点。部分站点从本机直连被区域/网络拦截（docs.anthropic.com、docs.x.ai、ai.google.dev、docs.mistral.ai、docs.together.ai、docs.perplexity.ai、huggingface.co），这些平台内容取自搜索索引里的**官方页面正文**，凡未能拿到原始响应字段的都在表中标「未确认」，未做推断。

判定口径（结合本插件现有能力：单次 GET + Bearer/API key + 单层数值字段）：

- **易**：现有「自定义」模板零改动能配出来（单一 GET、普通 key、可直接取数值字段）。
- **中**：能查，但需要 Admin/Management 级 key、额外路径参数（team_id / account_id）或时间区间，插件要小改或用户得手工拼参数。
- **难**：需要云服务账号 / BigQuery / 控制台会话等重链路，不适合做插件预设。
- **不可行**：官方没有可用于程序化查询余额或用量的接口。

## 汇总表

| 平台 | 能查到什么（余额/用量/额度） | 接口（方法 + URL） | 鉴权（哪种 key / 权限） | 返回字段示例（JSON 路径） | 适合做预设 | 官方文档 URL | 坑 / 备注 |
|---|---|---|---|---|---|---|---|
| OpenAI | 用量、花费（**不能查余额**） | `GET https://api.openai.com/v1/organization/usage/completions?start_time=<unix>&bucket_width=1d`；`GET https://api.openai.com/v1/organization/costs?start_time=<unix>&bucket_width=1d` | 组织 **Admin API key**（`sk-admin-...`）；普通 API key 不行 | 用量：`data[].results[].input_tokens`、`.output_tokens`、`.num_model_requests`；花费：`data[].results[].amount.value`、`.amount.currency`（USD） | 中（余额不可行；用量要 Admin key+时间区间+双层数组求和，插件需扩展） | [Cookbook/示例见 API Reference: Costs](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs)、[Usage Completions](https://developers.openai.com/api/reference/cli/resources/admin/subresources/organization/subresources/usage/methods/completions) | 官方文档无「剩余余额」接口；社区/官方论坛明确说没有，`/v1/dashboard/billing/credit_grants` 是未公开的 legacy 端点、不在当前 API Reference 里，不能当预设依赖。花费 ≠ 余额。 |
| Anthropic Claude | 用量（token）、花费（**不能查余额**） | `GET https://api.anthropic.com/v1/organizations/usage_report/messages?starting_at=<RFC3339>&ending_at=<RFC3339>&bucket_width=1d`；`GET https://api.anthropic.com/v1/organizations/cost_report?starting_at=<RFC3339>&bucket_width=1d` | **Admin API key**（`sk-ant-admin01-...`，Console → Settings → Admin keys，仅组织管理员）；请求头 `x-api-key` + `anthropic-version` | 用量：`data[].results[].input_tokens`、`.output_tokens`、`.cache_creation.ephemeral_5m_input_tokens`、`.cache_read_input_tokens`、`.model`；花费：`data[].results[].amount`（字符串，**最低货币单位/分**，`"123.45"` USD = $1.23）、`.currency` | 中（余额不可行；需 Admin key + 时间区间 + 嵌套求和） | [Cost Report](https://platform.claude.com/docs/en/api/admin/cost_report/retrieve.md)、[Usage Report](https://platform.claude.com/docs/en/api/beta/organization/usage_report/retrieve_messages)、[创建 Admin key](https://platform.claude.com/docs/en/manage-claude/admin-api-keys) | 余额只有 Console 里能看，官方明确「没有任何 API 返回剩余预付费余额」（官方 SDK 仓库 issue 也是这个结论）；cost_report 是估算值、不含 Priority Tier，和多处金额需要 /100。 |
| Google Gemini / Vertex | Gemini API：**无**余额/用量接口；AI Studio 的 Prepay 余额只在控制台；Vertex：只能走 Cloud Billing（BigQuery 导出 / Cloud Monitoring） | 无简单 GET；Vertex 侧：Cloud Billing API（billingAccounts）+ BigQuery 计费导出；AI Studio 余额看 Console | Gemini API key 没有此能力；GCP 需要 service account + billing 只读 + BigQuery 数据集 | —（未确认任何「剩余 credit」字段） | Gemini API：**不可行**；Vertex：**难**（云账单链路，非单次 GET） | [Gemini API billing](https://ai.google.dev/gemini-api/docs/billing)、[Cloud Billing API](https://cloud.google.com/billing/docs/reference/rest) | Cloud Billing API 只给账单账号/项目/价格目录，**不返回剩余额度或已花费金额**；真实花费要先开 BigQuery 计费导出（T+1，不追溯）。Gemini API 文档全线只有 rate limit（RPM/TPM/RPD），没有消费查询接口。 |
| xAI Grok | 预付费余额、用量/发票（管理 API） | `GET https://management-api.x.ai/v1/billing/teams/{team_id}/prepaid/balance`；另有同前缀 `invoices`、`usage`（POST） | **Management API key**（Console → Settings → Management Keys）+ **team_id**；推理 key 不被接受 | 未确认（多方一致说法：余额以「分」为单位的带符号合计；精确字段名文档未取到） | 中（需 management key + team_id，插件要加参数） | [Management REST API](https://docs.x.ai/developers/rest-api-reference/management) | 余额与 Grok 消费订阅（grok.com/SuperGrok）完全无关，订阅额度拿不到；管理 API 与推理 API 是两套 key。字段名需实测再写死。 |
| Mistral | 用量 + 花费（Admin API，按类别/模型嵌套）；**余额仅网页控制台** | `GET https://api.mistral.ai/v1/admin/usage?month=<M>&year=<YYYY>`（可选 `workspace_id`、`api_zone`） | **Admin API key**（Backoffice 创建），请求头 `x-api-key` | `currency`、`start_date`、`end_date`，`completion.models.<模型>.…`、`ocr.models.<模型>.…`、`connectors.…`、`libraries_api.…`、`fine_tuning.…`、`vibe_usage`（按类别嵌套；单一「总花费」字段未确认） | 中/难（需 Admin key + 深层嵌套；余额不可行） | [Usage metrics（Admin API）](https://docs.mistral.ai/admin/admin-api/usage-metrics) | 普通推理 key 不能查；credits 余额只在 `admin.mistral.ai` 网页会话里，不是公开 API。响应是分类别嵌套结构，不是单个数。 |
| Cohere | 用量/额度：**只能看控制台 dashboard**，API 无接口 | 无 | — | — | **不可行** | [Cohere API rate limits / keys](https://docs.cohere.com/docs/rate-limits) | 官方 API Reference 里没有 usage/billing 端点；trial/prod key 的月度调用额度只在 dashboard 显示。若企业版有单独接口，未公开文档，未确认。 |
| Groq | 用量/花费：**公开 API 没有**；控制台账单页看；企业版有 Prometheus 指标 | 无（普通 API key 无接口） | — | — | **不可行** | [Groq Billing FAQs](https://console.groq.com/docs/billing-faqs) | 免费/开发者层级用量看 console；能用程序化查的只有企业版 Prometheus 指标，普通 key 返回空。 |
| Together | 用量 + 花费（billing usage，按月、cost-annotated line items，含金额） | `GET https://api.together.ai/v1/billing/usage?month=<YYYY-MM>&granularity=day`（翻页用响应里的 `next_cursor`） | Bearer **Together API key**（key 需带 billing 权限；任意项目 key 可读整个组织） | 未确认（官方描述：按月返回「cost-annotated line items grouped into time windows」；具体字段名文档正文未取到） | 中（需月份参数 + 数组求和；字段待实测） | [Get billing usage](https://docs.together.ai/reference/billing-usage) | 当前月数据最多延迟 1 小时；`next_cursor` 翻页；没有「余额」接口，只有已消费金额。文档站被 Cloudflare 拦，响应字段要实测补。 |
| Fireworks | 用量（token/GPU 秒等数量）+ 花费（总额/按日/按产品） | `GET https://api.fireworks.ai/v1/accounts/{account_id}/billing/summary?startTime=<ISO>&endTime=<ISO>`（+`granularity=DAILY`）；`GET https://api.fireworks.ai/v1/accounts/{account_id}/billingUsage?startTime=<ISO>&endTime=<ISO>` | Bearer **Fireworks API key** + **account_id** | `lineItems[].totalCost.{units,nanos,currencyCode}`（units=整数美元，nanos=10⁻⁹）、`usageBuckets[].lineItems[]`；`billingUsage` 只有数量无美元 | 中（account_id + 时间区间；金额是 units/nanos 要换算；无余额） | [Usage & Cost Breakdown](https://docs.fireworks.ai/accounts/exporting-usage-and-costs)、[Get billing summary](https://docs.fireworks.ai/api-reference/get-billing-summary) | `billingUsage` 不返回美元，金额在 `billing/summary`；时间区间必填、最多 31 天；没有 credit 余额接口。 |
| Perplexity | API 余额/用量：**未找到官方接口**（控制台账单页手动看）；另有面向 Computer 的组织 Analytics API，是否覆盖 API credits 未确认 | `GET /v1/analytics/computer/usage?dataset=credit_usage&start_time=<unix>`（base 未确认；组织 Analytics key） | 组织 analytics API key（org admin 在 Settings → Organization 生成） | 未确认（bucket 时间序列） | **不可行**（API 余额），Analytics 未确认 | [Perplexity pricing / billing](https://docs.perplexity.ai/docs/getting-started/pricing)、[Computer usage analytics](https://docs.perplexity.ai/api-reference/computer-analytics-usage-get) | 「API credits/余额」没有公开端点；Analytics API 是 Computer 产品口径，别直接当 API 余额用。 |
| OpenRouter | 余额/限额 + 用量（日/周/月）+ BYOK | `GET https://openrouter.ai/api/v1/key`；`GET https://openrouter.ai/api/v1/credits`（账户总额度，需 Management key） | 前者：任意可用 **API key**（Bearer）；后者：**Management key** | `/key`：`data.limit_remaining`（无 key 限额时 **null**）、`data.limit`、`data.usage`、`data.usage_daily/weekly/monthly`、`data.byok_usage*`、`data.effective_budget`；`/credits`：`data.total_credits`、`data.total_usage` | **易**（`/api/v1/key`，现有模板直接可配） | [Checking your limits](https://openrouter.ai/docs/api-reference/limits)、[Credits](https://openrouter.ai/docs/api-reference/get-credits) | 最接近「余额」的字段是 `limit_remaining`，但没给 key 设限额时是 null；账户真实剩余 = `total_credits - total_usage`，插件不做减法，所以只能显示已用/总额。 |
| Replicate | 余额/用量：**官方 API 无**；账户身份可查；账单看 dashboard / 发票 JSON | `GET https://api.replicate.com/v1/account`（只返回身份） | Bearer **Replicate API token** | `type`、`username`、`name`、`github_url`（无金额字段） | **不可行** | [HTTP API: Get the authenticated account](https://replicate.com/docs/reference/http#account.get)、[Billing](https://replicate.com/docs/topics/billing) | 网传的 `/v1/account/billing/usage` 不在官方 HTTP API 文档里，**未确认**，不要用；预付费余额只在 dashboard。 |
| HuggingFace | 身份/plan（PRO/Free）可查；**余额/用量未公开文档化** | `GET https://huggingface.co/api/whoami-v2`（Bearer token）；billing 的 `/api/settings/billing/usage-v2` 只在 OpenAPI spec 里出现 | 用户 access token（read 即可） | whoami：`name`、`plan`、`orgs[]`、`auth.type`；billing 端点响应结构未文档化（未确认） | **不可行**（余额），billing 端点未确认 | [Hub API](https://huggingface.co/docs/hub/api)、[Inference Providers](https://huggingface.co/docs/api-inference) | 预付费 compute credits 只在网页 Credits 页；`usage-v2` 需要 `startDate`/`endDate`（unix），但官方没有响应字段文档，属内部接口，不能当稳定预设。 |

## 结论

### 可直接做预设（按易用度排序）

1. **OpenRouter —— 易**：`GET https://openrouter.ai/api/v1/key`，普通 Bearer key，余额取 `data.limit_remaining`、用量取 `data.usage_daily` / `data.usage_monthly`。现有「自定义」模板零改动能直接配（余额字段可能为 null，要接受空值）。账户总额度（`total_credits - total_usage`）需要 Management key，且要插件做减法，暂不做预设。
2. **xAI Grok —— 中**：Management key + team_id，`GET /v1/billing/teams/{team_id}/prepaid/balance`。需要给预设加一个「team_id」输入 + 管理密钥，且返回字段要先实测确认。
3. **Together —— 中**：Bearer key，`GET /v1/billing/usage?month=YYYY-MM&granularity=day`，按月返回含金额的 line items，要插件按数组求和并加 `{month}` 参数；响应字段待实测。
4. **Fireworks —— 中**：account_id + 时间区间，`/v1/accounts/{account_id}/billing/summary`，金额 `units+nanos/1e9`；要插件支持路径参数、时间区间和金额换算。
5. **Mistral —— 中/难**：Admin API key，`GET /v1/admin/usage?month=&year=`，返回按类别/模型嵌套的用量与花费，需要插件支持深层求和。
6. **Anthropic —— 中/难**：Admin key，`cost_report`（金额是「分」的字符串，要 /100）+ `usage_report`；**只有花费/用量，没有余额**，只能当「本月花费」指标。
7. **OpenAI —— 中/难**：Admin key，`/v1/organization/costs` + `/v1/organization/usage/completions`；**没有余额接口**，`costs` 是双层数组，需插件扩展。

### 不可行（官方没有可用的余额/用量接口）

- **Cohere**：只有 dashboard，无 API。
- **Groq**：只有 console dashboard；企业版 Prometheus 不算普通预设。
- **Replicate**：API 只有身份；余额只看 dashboard/发票。
- **Perplexity**：API 余额无接口（Computer Analytics 不算）。
- **HuggingFace**：余额只在网页；billing 端点未文档化（未确认）。
- **Google Gemini API**：无接口；Vertex 走 Cloud Billing/BigQuery，属「难」，不建议做预设。

### 「订阅制」明显拿不到的

ChatGPT/Codex 订阅额度、Claude Pro/Max、Gemini Advanced / AI Studio 订阅配额、SuperGrok/Grok 订阅、HF PRO 的 ZeroGPU 配额——这些都没有官方 API，只能靠网页会话或本地统计，**不要指望做预设**。

### 给插件实现的落地建议（按需扩展）

- 现有能力只覆盖「单 GET + 单层数值 + 单一 usage 数组求和」；上述「中」档平台普遍缺 4 个能力：
  1. 路径参数（`{team_id}`、`{account_id}`）；
  2. 动态时间参数（`{month}`、`{start}`、`{end}`，现有只有 `{7d}`/`{now}` 且仅用于 usageUrl）；
  3. 双层数组求和（`data[].results[].amount.value`，OpenAI/Anthropic 都需要）；
  4. 数值换算（分→元、units+nanos、`total_credits - total_usage`）。
- 在补这些之前，建议内置预设只加 **OpenRouter**；其余先引导用户用「自定义」，并在预设说明里注明「需 Admin/Management key、只有用量没有余额」。
