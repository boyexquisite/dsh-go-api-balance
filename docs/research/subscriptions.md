# 订阅制套餐的「用量/剩余额度」能不能显示？（task-15）

> 核查日期：2026-11-13。范围：Claude Pro/Max、ChatGPT Plus/Pro、Gemini Advanced（Google AI Pro/Ultra）、GitHub Copilot、Cursor、Windsurf、Perplexity Pro、Kimi 会员 / Kimi Code、智谱 GLM Coding Plan、new-api/one-api 中转站订阅。
>
> 方法：只查公开资料（官方文档 / 官方客户端公开源码 / 公开逆向记录 / 社区实现），未用真实账号实测。标「未确认」的条目**没有可靠公开来源**，不要当既成事实。
>
> 与本插件的关系：插件（见 [spec.md](../spec.md) §2）只认 **JSON 接口**，鉴权方式仅 `bearer / header / query / cookie / basic / login`，没有 OAuth 刷新、没有浏览器、不能过 Cloudflare/Turnstile 挑战。所以「技术上能写个脚本拿到」≠「适合做进插件」。

---

## 0. 结论速览

| 平台 | 能否拿到用量/剩余 | 需要的凭证 | 官方接口？ | ToS / 风控风险 | 插件适配 | 建议 |
|---|---|---|---|---|---|---|
| **Claude Pro/Max**（claude.ai 网页） | 能（非官方）：`/api/organizations/{org}/usage` | `sessionKey` + `lastActiveOrg` + `cf_clearance`（Cloudflare TLS 绑定） | 否 | **高**：Anthropic 明确禁止订阅 OAuth 用于第三方；网页 API 受 Cloudflare 保护 | 差（cookie 会 403，且拿不到 cf_clearance） | **不做** |
| Claude Code（订阅 OAuth） | 能（半官方）：`api.anthropic.com/api/oauth/usage` | Claude Code 的 OAuth access token（~24h，带 refresh token） | 端点被官方客户端使用，但**明确只许原生应用** | **高**：官方合规文档要求第三方改用 API key | 差（需 OAuth 刷新，插件无此机制） | **不做** |
| **ChatGPT Plus/Pro** | 能（非官方）：cookie 换 bearer 后 `chatgpt.com/backend-api/wham/usage` | `__Secure-next-auth.session-token` cookie → `/api/auth/session` 的 accessToken | 否（逆向） | **中高**：OpenAI 条款禁止自动化/程序化提取与规避限流 | 技术上可配（cookie + Bearer），但不稳 | **不做** |
| **Gemini Advanced / Google AI Pro** | 有社区路径（gemini.google.com 内部 RPC，`getUsageInfo`），但复杂 | Google 登录 cookie | 否；**官方确认无公开配额 API** | 中高：Google 服务条款限制自动化访问 | 差（RPC 参数随前端变） | **不做**，标「未确认/不可靠」 |
| **GitHub Copilot** | 官方 billing API 只能查**已用**（premium request/用量报表）；**剩余**只有内部接口 `copilot_internal/user` | 官方：fine-grained PAT（Plan read）；内部：GitHub OAuth/Copilot token | 部分（用量报表） | 中：内部接口非公开授权；官方接口个人账号能否查本人**未确认** | 中（API key/静态 token 是插件友好的） | **可做但有限**（只显示「本月已用」，不显示「剩余」） |
| **Cursor** | 能（非官方）：`cursor.com/api/usage-summary` | `WorkosCursorSessionToken` cookie（`{userId}::{token}`） | 只有 Enterprise Admin API（官方） | **高**：Cursor AUP 明文禁止「机器人/脚本/自动化方式访问服务」「干扰用量计量」 | 技术上可配（cookie + JSON） | **不做** |
| **Windsurf** | 个人版：**拿不到**；仅 Enterprise 有官方 API | Enterprise Service Key | Enterprise 专属 | 低（但个人无接口） | 无 | **不做**（个人版不可行） |
| **Perplexity Pro** | 能（非官方）：`perplexity.ai/rest/billing/credits` | `__Secure-authjs.session-token` 等 session cookie | 否 | 中高：AUP 禁止未授权访问/干扰保护 | 技术上可配（cookie + Origin/Referer） | **不做** |
| **Kimi 会员 / Kimi Code** | 能（半官方）：`api.kimi.com/coding/v1/usages`（Kimi CLI `/usage` 同源） | Kimi Code API key（Bearer）或 OAuth token | 官方客户端在用；**未确认对外文档化** | 低（用自己 key 查自己额度） | **好**（Bearer + JSON） | **可做（实验性模板）** |
| **智谱 / Z.ai GLM Coding Plan** | 能（半官方）：`/api/monitor/usage/quota/limit` | 平台 API key（raw，不加 `Bearer`）+ org/project 头 + `?type=` | 官方文档只写「到控制台看用量」，接口未文档化 | 低—中（用自己 key；接口随版本变） | **较好**（header/query + JSON），需 2 个额外头 | **可做（实验性模板）** |
| **new-api / one-api 中转站订阅** | 能（站点自带）：`/api/user/self` 含 `subscription_quota` / `subscription_unlimited` | 站点 access token 或登录 cookie + `New-Api-User` 头 | 是（new-api 官方有订阅功能，站点文档有字段说明） | 低（站点自己的用户 API） | **好**（与现有 `newapi` 模板同类） | **可做（优先）** |
| 其他自研中转站「套餐」 | 站点间无统一接口 | 各不相同 | 无统一 | 按站点条款 | 用「自定义服务」让用户自己填 | **可做（只做通用自定义，不做预置）** |

**一句话结论**：包月订阅的「剩余额度」基本都能从**网页会话**里扒到，但几乎全是**非公开内部接口 + 明令/默示禁止自动化**；插件只适合做「官方 API key 能拿到的」那几家（Kimi Code、GLM Coding Plan、new-api 订阅、Copilot 的已用量），消费级网页订阅（Claude / ChatGPT / Gemini / Cursor / Perplexity）**不建议**内置，最多做「打开官方用量页」的替代。

---

## 1. 判定口径

把「查到接口」和「适合插件」分开。插件自定义服务能做的：

- 一次 GET/POST，返回 JSON；从 JSON 里按路径取一个数值当「余额」，再取若干数值当明细（[spec.md](../spec.md) §2 `balancePath` / `detailText`）。
- 鉴权：Bearer / 自定义 header / query / cookie / basic / 登录换 token（`login` + `tokenPath`）。
- 额外请求头最多 4 KiB 的 JSON（`headersText`），可以塞 `Origin` / `Referer` / `X-*`。

插件**不能**做的（决定了下面的判断）：

- OAuth 授权码/设备流、refresh token 轮换 → Claude Code、Codex、Copilot 的 OAuth 路线都不适合。
- 执行 JS 挑战 / 过 Cloudflare Turnstile / 伪造 TLS 指纹 → 一律不建议，也不写。
- 解析 HTML、跟随前端 RPC 版本变化 → 不适合长期维护。
- 保存高价值消费级会话 cookie（等于账号密码）在手机 `config.json`（0600）里 → 泄露面太大。

因此本文的「可做」标准：**用户自己的 API key（或站点 token）+ 稳定 JSON + 官方/半官方认可**。

---

## 2. 逐个平台

### 2.1 Claude Pro / Max

有两条路，都不适合插件。

**A. claude.ai 网页内部接口（社区逆向）**

- `GET https://claude.ai/api/organizations/{orgId}/usage`
- 凭证（三件套）：
  - `sessionKey`（`sk-ant-sid01-...`，登录会话）
  - `lastActiveOrg`（组织 UUID，`orgId` 也从这里取）
  - `cf_clearance`（Cloudflare 通行证）
- 返回结构（[claude-web-usage](https://www.npmjs.com/package/claude-web-usage) 文档）：

```jsonc
{
  "five_hour": { "utilization": 28, "resets_at": "2026-03-06T03:00:00+00:00" },
  "seven_day": { "utilization": 41, "resets_at": "..." },
  "limits": [ { "kind": "...", "percent": 41, "resets_at": "..." } ]
}
```

- 稳定性：**差**。`cf_clearance` 与浏览器 TLS 指纹绑定，换进程/换 IP 就 403；社区实现（[claude-web-usage](https://socket.dev/npm/package/claude-web-usage)、[OmniRoute #3046](https://github.com/cheaper-inference/OmniRoute/pull/3046)）必须做 in-process 请求并注入/刷新 `cf_clearance`，甚至有项目用 Turnstile 求解器（我们**不做**这种绕过）。插件用 Node `fetch`，指纹与浏览器不同，**大概率直接 403**（未实测）。

**B. Claude Code 的 OAuth 用量端点（半官方）**

- `GET https://api.anthropic.com/api/oauth/usage`
- 头：`Authorization: Bearer <access_token>`、`anthropic-beta: oauth-2025-04-20`、`User-Agent: claude-code/<version>`
- 返回：5 小时/7 天窗口的 utilization、reset 时间（[Claude-Code-Usage-Monitor #202](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/202)）。
- 凭证来自 `~/.claude/.credentials.json`；access token 约 24h 过期、需 refresh token 轮换（[claude-code #42904](https://github.com/anthropics/claude-code/issues/42904)）。插件做不了刷新。

**合规**：Anthropic 消费级条款 §3 禁止「除 API key 或明确许可外，通过自动化/非人类方式访问服务」（[Consumer Terms](https://www.anthropic.com/legal/consumer-terms)，引文见 [awesome-ai-gateway 记录](https://github.com/cuihuan/awesome-ai-gateway/commit/9c25b72a8ed4b0e4e3f2cfe87094279fb1926cde)）；Claude Code 合规文档要求第三方产品**必须用 API key**，订阅 OAuth 只供官方原生应用（[code.claude.com/legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance)，引文见 [wslmanager 记录](https://github.com/bostrot/wslmanager/blob/a1e938323c32b5d59147645968bbe67d55294a93/doc/claude-sign-in-policy.md)）。2026-02 起 Anthropic 进一步明确禁止第三方使用订阅 OAuth。

**结论**：不做。要显示 Claude 余额，只能显示 **API 平台（Console）的预付余额**，那是另一套东西（API key / Admin key），不是 Pro/Max 套餐。

### 2.2 ChatGPT Plus / Pro

**非官方内部接口，两步：**

1. `GET https://chatgpt.com/api/auth/session`（带 `__Secure-next-auth.session-token` cookie）→ 返回 `accessToken`；
2. `GET https://chatgpt.com/backend-api/wham/usage`
   - 头：`Authorization: Bearer <accessToken>`，可选 `ChatGPT-Account-Id`
   - 返回（[OpenTokenUsage codex 文档](https://github.com/PowerUserZ/OpenTokenUsage/blob/main/docs/providers/codex.md)）：

```jsonc
{
  "plan_type": "plus",
  "rate_limit": {
    "primary_window":   { "used_percent": 6, "reset_at": 1738300000, "limit_window_seconds": 18000 },
    "secondary_window": { "used_percent": 24, "reset_at": 1738900000, "limit_window_seconds": 604800 }
  },
  "credits": { "...": "..." }
}
```

（`18000s` = 5 小时窗口，`604800s` = 7 天窗口。）

- 失效频率：session cookie 可活数月；拿它换出来的 bearer 约 **5—9 天**过期，cookie 还在就能再换（[local-chatgpt-token-heal](https://github.com/tonydzi/second-brain-starter-kit/blob/master/skills/local-chatgpt-token-heal/SKILL.md)、[gptme 记录](https://github.com/gptme/gptme/blob/fcd16c63783ddd7fa6666bfd4915ee77705ef7ca/gptme/llm/llm_openai_subscription.py)）。CodexBar 也把「OpenAI 网页 cookie」列为 Codex 的辅助来源（[codex.md](https://github.com/steipete/CodexBar/blob/main/docs/codex.md)）。
- 稳定性：中。`wham` 是逆向出来的端点；chatgpt.com 有 Cloudflare，Node 直连是否被拦**未实测/未确认**。
- 合规：OpenAI 使用条款禁止「自动或程序化提取数据或输出」「规避速率限制或保护措施」（[Terms of Use](https://openai.com/policies/terms-of-use)，条款摘录见 [ConductAtlas](https://conductatlas.com/platform/openai/openai-terms-of-use/provision/CA-P-078686/no-automated-extraction-of-data-or-output/)）。

**结论**：技术上能配成 cookie 自定义服务，但属于未公开接口 + 灰区条款 + 账号会话高价值，**不做预置**。

### 2.3 Gemini Advanced / Google AI Pro

- **官方没有**给个人订阅者的配额查询 API。社区在 [gemini-cli #29796](https://github.com/google-gemini/gemini-cli/issues/29796) 里明确抱怨 Google 下线个人账号的 Gemini CLI OAuth 后，「付费个人订阅者没有任何公开配额 API」。
- 社区实现（CodexBar）走两条非官方路：
  - **Gemini app**：带浏览器 cookie 请求 `gemini.google.com` 内部 RPC，从 `data.viewer.rpcs.getUsageInfo.pools` 读 `GXU_FIVE_HOURLY` / `GXU_WEEKLY`（[CodexBar gemini.md](https://github.com/steipete/codexbar/blob/20ada8abf0e4e2267aaa8c7cc9cf891cdf866838/docs/gemini.md)、[PR #4535](https://github.com/steipete/CodexBar/pull/4535)）。精确 RPC URL / 参数**未确认**，随前端版本变。
  - **Gemini CLI OAuth**：`cloudcode-pa` 私有配额接口；个人 OAuth 已下线。
- 合规：Google 服务条款限制「通过自动化方式访问服务」（[Google ToS](https://policies.google.com/terms)，历史引文见 [StackOverflow](https://stackoverflow.com/revisions/80d68270-c3bd-4a3e-9f38-982f8567904d/view-source)）。**是否覆盖 gemini 用量页未确认**。
- 结论：**不做**；列为「未确认 / 不建议」。

### 2.4 GitHub Copilot

分官方与内部两条：

**官方 billing API（只能算「已用」）**

- `GET https://api.github.com/users/{username}/settings/billing/premium_request/usage`：拉某用户某月 premium request 使用报表；fine-grained token 需要 **Plan (read)** 权限（[GitHub REST billing/usage](https://docs.github.com/en/rest/billing/usage)）。
- `GET /users/{username}/settings/billing/usage`：计费用量报表（AI Credits 等）。
- 限制：返回的是**已发生用量/账单**，不是「本月还剩多少」；且「调用者需有权查看该用户报表」，**个人 Copilot Pro 用本人 PAT 能否读自己是未确认**。
- 背景：2026-06-01 起 Copilot 个人版从「premium request 月配额」改为 **AI Credits 按量计费**（Pro $10 / Pro+ $39 / Max $100），用量在 dashboard 看（[迁移说明](https://github.com/theopenco/llmgateway/blob/cb90c508bad7d6f20fa4da14e6e56600023949f5/apps/ui/src/content/migrations/github-copilot.md)、[GitHub billing 文档](https://docs.github.com/en/rest/billing/usage)）。

**内部接口（能拿「剩余」但非公开）**

- `GET https://api.github.com/copilot_internal/user`，`Authorization: Bearer <copilot_token>` → `quota_snapshots.premium_interactions` / `.chat`（[opencode #768](https://github.com/anomalyco/opencode/issues/768)、[CodexBar copilot.md](https://github.com/steipete/codexbar/blob/7447bc77c2497323d9c41e40164ce705533493c8/docs/copilot.md)）。
- copilot token 由 `api.github.com/copilot_internal/v2/token` 用 GitHub token 换，**约 30 分钟**过期（[Bifrost Copilot 文档](https://github.com/maximhq/bifrost/blob/ff2e69f7f0143ab79c9de5258b90bd9c70cf347b/docs/providers/supported-providers/github-copilot.mdx)）；插件没有 OAuth 刷新，手填 30 分钟过期 token 不现实。
- GitHub 是否允许个人用设备流 OAuth 调这个内部接口：**未确认**；内部接口无公开授权承诺。

**结论**：可做「有限」方案——只接**官方 billing 用量报表**（显示「本月已用 N 次 premium request / 已用 AI Credits」，不是剩余），要求用户自己建 fine-grained PAT；或者干脆不做。**不接**内部接口。

### 2.5 Cursor

- 非官方 dashboard 接口：`GET https://cursor.com/api/usage-summary`
  - Cookie：`WorkosCursorSessionToken={userId}::{token}`（也接受 `__Secure-next-auth.session-token`）
  - 返回（社区类型定义，[ai-usagebar cursor types](https://docs.rs/ai-usagebar/1.12.0/ai_usagebar/cursor/types/index.html)）：

```jsonc
{
  "billingCycleStart": "2026-07-04T...", "billingCycleEnd": "2026-08-04T...",
  "membershipType": "ultra",
  "isUnlimited": false,
  "individualUsage": {
    "plan":     { "autoPercentUsed": 98.1, "apiPercentUsed": 100, "totalPercentUsed": 98.5 },
    "onDemand": { "enabled": true, "used": 0, "limit": null }
  }
}
```

- 取数方式：从 Cursor 本地 `state.vscdb` 读 `cursorAuth/accessToken`（JWT），`sub` 即 userId，拼成 cookie 调接口（[cursorhub](https://pypi.org/project/cursorhub/0.1.1/)）。说明这是**网页 dashboard 自用的接口**。
- 官方 API：只有 **Enterprise** 的 Admin API（`api.cursor.com`，API key，team 用量/花费），Business 及以下不可用（[c1.ai Cursor connector 文档](https://www.c1.ai/docs/baton/cursor)）。
- 合规：Cursor AUP 明文禁止「使用机器人访问服务」「通过机器人/脚本等自动化或非人工方式访问服务」「直接或自动化操纵、规避或干扰订阅、计费或用量计量系统」（[Cursor AUP](https://cursor.com/cn/acceptable-use-policy)，2026-08 版）。
- 结论：**不做**。技术可行但 AUP 直接点名，预置模板会让我们成为「教用户违规」的一方。

### 2.6 Windsurf

- 个人版：**没有公开 REST API**（第三方 API 目录也写「No public REST API for application developers」，[api-evangelist/windsurf](https://raw.githubusercontent.com/api-evangelist/windsurf/refs/heads/main/apis.yml)）。
- 官方确有 Enterprise API：`POST https://server.codeium.com/api/v1/GetTeamCreditBalance`，body 里放 `service_key`，返回每席位 prompt credits、add-on credits、`billingCycleStart` 等（[Windsurf API reference](https://docs.windsurf.com/ja/windsurf/accounts/api-reference/api-introduction)、[GetTeamCreditBalance](https://docs.windsurf.com/pt-BR/plugins/accounts/api-reference/get-team-credit-balance)）。
- 结论：**个人版不可行**；Enterprise 用户也不在插件目标人群（插件是个人手机面板），不做。

### 2.7 Perplexity Pro

- 非官方接口：`GET https://www.perplexity.ai/rest/billing/credits?version=2.18&source=default`
  - Cookie：`__Secure-authjs.session-token` / `authjs.session-token` / `__Secure-next-auth.session-token` / `next-auth.session-token` 任一
  - 还要带 `Origin: https://www.perplexity.ai`、`Referer: https://www.perplexity.ai/account/usage`
  - 返回：周期性/赠送/购买的 credit 余额（CodexBar 用它显示 credit，[perplexity.md](https://github.com/steipete/CodexBar/blob/main/docs/perplexity.md)）。
- 会话有效期：NextAuth session 一般数周（**具体未确认**）。
- 合规：Perplexity AUP 禁止「以未经授权的方式访问」「干扰/破坏保护措施」「绕过滥用保护」（[Perplexity AUP](https://www.perplexity.ai/zh/hub/legal/aup)）；**是否点名「读取自己用量」未确认**，但用未公开接口 + 浏览器 cookie 属灰区。
- 结论：**不做预置**。用户真想用可自己在「自定义服务」里配（cookie + 两个头 + JSON 路径），风险自负；文档不教如何取 cookie。

### 2.8 Kimi 会员 / Kimi Code

先分清两个东西：**Kimi 网页会员** 和 **Kimi Code（Kimi for Coding）订阅**。Kimi 官方帮助页说两者共用同一份 credit 余额，CLI 有 `/usage`，控制台也能看（[Kimi Code 订阅说明](https://www.kimi.ai/ru/help/kimi-code/benefits)）。

- **Kimi Code 用量接口**：`GET https://api.kimi.com/coding/v1/usages`
  - `Authorization: Bearer <access_token 或 API key>`
  - 返回（[OpenTokenUsage kimi 文档](https://github.com/PowerUserZ/OpenTokenUsage/blob/main/docs/providers/kimi.md)、[hermes-agent 解析实现](https://github.com/NousResearch/hermes-agent/commit/db9c55b3ca5f0cb9e3fd7277c4446124b3bd0ee4)）：

```jsonc
{
  "usage": { "limit": "100", "remaining": "74", "resetTime": "2026-02-11T17:32:50Z", "timeUnit": "TIME_UNIT_MINUTE" },
  "limits": [ { "window": { "duration": 300, "timeUnit": "TIME_UNIT_MINUTE" }, "limit": "...", "remaining": "...", "resetTime": "..." } ],
  "user": { "level": "LEVEL_INTERMEDIATE" }
}
```

  - 这是 **Kimi CLI 官方客户端 `/usage` 用的同源接口**（[Kimi CLI KLIP-14](https://raw.githubusercontent.com/MoonshotAI/kimi-cli/main/klips/klip-14-kimi-code-oauth-login.md) 写明 `/usage` 依赖 Bearer），但**是否对外文档化未确认**。Kimi Code 的 API key 可以直接当 Bearer 用（KLIP 原文：现有配置以 API key 作为 `Authorization: Bearer <api_key>`）。
- **Kimi 开放平台余额**（不是会员）：`GET https://api.moonshot.cn/v1/users/me/balance`（国际站 `api.moonshot.ai`），官方文档，返回 available/voucher/cash balance（[Kimi API 文档](https://platform.kimi.ai/docs/api/balance)）。这是 API 余额，不是订阅剩余。
- 合规：用自己账号的 key 查自己额度，低风险；条款层面未见禁止（**未确认**）。
- 结论：**可做（实验性）**。插件里加一个「Kimi Code」模板：`authType=bearer`，`url=https://api.kimi.com/coding/v1/usages`，`balancePath=limits.0.remaining`（或 `usage.remaining`），明细映射各窗口；注明「非官方文档接口，Kimi 改版可能失效」。

### 2.9 智谱 / Z.ai GLM Coding Plan

- 用量口径：官方文档说每套餐同时有 **5 小时限额 + 每周限额**，进度到控制台「Usage Statistics / 订阅页」看（[Z.ai devpack FAQ](https://docs.z.ai/devpack/faq)、[Team Plan](https://docs.z.ai/devpack/teamplan.md)）——**官方没有给「查配额」的 REST 文档**。
- 社区逆向接口：`GET https://open.bigmodel.cn/api/monitor/usage/quota/limit`（国际站 `https://api.z.ai/api/monitor/usage/quota/limit`）
  - 头：`Authorization: <API key>`（**raw，不带 `Bearer`**）、`bigmodel-organization: org-xxx`、`bigmodel-project: proj_xxx`
  - query：`?type=2`（团队套餐实测为 2；个人新版疑似 1，**未验证**）
  - 返回：`data.limits[]`，含时间/Token/请求/会话等窗口的已用比例与重置时间（[pi-glm-quota 说明](https://www.npmjs.com/package/pi-glm-quota)、[hermes-quota-plugin zai.py](https://github.com/rarf/hermes-quota-plugin/blob/v2.8.2/quota_providers/zai.py)）。
- 稳定性：中。2026-07-30 套餐改版后接口调用方式变过一次（缺 `type` / org / project 头就报「没有 coding plan」），社区插件都在跟进。**未确认官方是否允许第三方调用**。
- 结论：**可做（实验性）**，但需要 org/project 两个头，普通用户不一定知道去哪找；表单里 `headersText` 可以填，体验一般。建议做成说明型模板 + 明确「可能失效」。

### 2.10 new-api / one-api 中转站订阅

这是**最适合**的一类：中转站自己提供用户 API，凭证是站点 token/cookie，不是消费级会话。

- new-api 官方已有订阅套餐功能（管理端创建套餐、用户端「我的订阅」）（[New API 订阅计划管理](https://docs.newapi.pro/zh/docs/guide/feature-guide/admin/subscription)、[钱包与订阅](https://docs.newapi.ai/ja/docs/guide/feature-guide/user/wallet)）。
- 用户余额接口：`GET /api/user/self`
  - 鉴权：系统访问令牌（`Authorization: Bearer`）**或**登录会话；另外必须带 `New-Api-User: <数字用户 ID>`，且必须与 token 所属用户一致
  - 返回字段（站点文档，[AnyFast 当前用户余额](https://docs.anyfast.ai/zh/guides/system-api/current-user-balance)、[QuotaBar NEWAPI_API](https://github.com/superpung/QuotaBar/blob/main/docs/NEWAPI_API.md)）：

```jsonc
{
  "data": {
    "quota": 12747995,              // 钱包余额 + 授信余额（quota 单位）
    "used_quota": 0,
    "wallet_quota": 500000,
    "credit_quota": 12247995,
    "subscription_quota": 1000000,  // 有限额订阅的剩余额度（不计入 quota）
    "subscription_unlimited": false,// 无限订阅
    "group": "vip", "username": "...", "display_name": "..."
  }
}
```

  - 注意：`data.quota` **不包含** `subscription_quota`；要显示订阅剩余得单独取这个字段（或 `subscription_unlimited=true` 时显示「无限」）。单位换算仍靠 `/api/status` 的 `quota_per_unit`（插件里已有，见 [spec.md](../spec.md) §7）。
- 订阅到期时间：前端「我的订阅」走 `/api/subscription/...` 系列，**具体路径未确认**（new-api PR 里是 `controller/subscription.go` 的 user/admin 端点，未在官方文档逐条列），建议按站点实测再补。
- 合规：低（站点自己的用户接口，用户 token）。
- 结论：**优先做**。现有 `newapi` 模板只需在取数时额外读 `data.subscription_quota` / `data.subscription_unlimited`，详情行显示「订阅剩余 / 订阅无限 / 到期（若能拿到）」。

### 2.11 其他中转站「订阅套餐」

- 绝大多数是 new-api 二开或类似面板，`/api/user/self` 结构大同小异；少数自研站（如各类「包月 Claude Code 中转」）有自己的一套「套餐余量」JSON，**无统一标准**。
- 插件已有「自定义服务」：让用户填 URL + 鉴权 + `balancePath` + `detailText` 即可覆盖，不需要为每家做预置。
- 提醒：套餐是否「按天/按请求数/按 token」差异很大，插件只显示用户指定的那个数字；文案别写死「余额」。

---

## 3. 凭证失效与风险汇总

| 平台 | 凭证类型 | 失效频率 | 自动化条款 | 账号风险 |
|---|---|---|---|---|
| Claude 网页 | sessionKey+cookie | `cf_clearance` 几分钟—几小时（TLS 绑定）；sessionKey 登出/改密失效 | 明确禁止（消费条款 §3 + 合规文档） | 高（封号/登出） |
| Claude Code OAuth | Bearer access token | ~24h，需 refresh token | 第三方订阅 OAuth 被禁止 | 高 |
| ChatGPT 网页 | session cookie → bearer | bearer 5—9 天；cookie 数月 | 禁止自动化提取/规避限流 | 中高（会话被撤销） |
| Gemini 网页 | Google cookie | 数周（未确认） | Google ToS 限制自动化 | 中高 |
| Copilot 官方 | fine-grained PAT（Plan read） | 长期（用户自定） | 官方 API，合规 | 低 |
| Copilot 内部 | GitHub token → copilot token | copilot token ~30 分钟 | 内部接口，未公开授权 | 中 |
| Cursor | Workos session cookie | 数周—数月（未确认） | AUP 明确禁止自动化/干扰计量 | 高 |
| Perplexity | NextAuth session cookie | 数周（未确认） | AUP 禁止未授权访问/干扰 | 中 |
| Kimi Code | API key（或 OAuth token） | key 长期；token 短 | 未见禁止（未确认） | 低 |
| Z.ai GLM | API key | 长期 | 未见禁止（未确认） | 低 |
| new-api 中转 | 站点 token / cookie | token 长期；cookie 会过期 | 站点条款 | 低 |

---

## 4. 建议

### 4.1 可做（按优先级）

1. **new-api / one-api 订阅额度**（优先）：官方功能、站点 token、字段明确。改 `newapi` 模板读 `subscription_quota` / `subscription_unlimited`，`quota` 为 0 但订阅有额度时别显示成「0 元」。
2. **Kimi Code / Kimi for Coding**（实验性模板）：`Bearer` + `GET https://api.kimi.com/coding/v1/usages`，显示 5h/周/月窗口的 `remaining`。标注「接口未公开文档化」。
3. **智谱 GLM Coding Plan**（实验性模板）：`header` 鉴权 + org/project 头 + `?type=`；表单填 2 个额外头不友好，建议先在文档里给示例，等接口稳定再做预置。
4. **GitHub Copilot**（可选、有限）：只接官方 billing 报表显示「本月已用」，不显示「剩余」；需要用户自建 fine-grained PAT（Plan read），且个人能否查本人**未确认**，先不做也行。

### 4.2 不建议做

- **Claude Pro/Max、ChatGPT Plus/Pro、Gemini Advanced、Cursor、Perplexity Pro** 的网页会话接口：ToS 明确或高度疑似禁止自动化 + 需浏览器 cookie/TLS 指纹 + 插件架构不支持 OAuth 刷新。预置模板等于把违规路径产品化。
- **Windsurf 个人版**：没有接口，不是风险问题，是做不到。
- **Claude Code / Codex / Copilot 的 OAuth 路线**：插件没有 refresh token 机制，手填短期 token 会天天失效。
- 任何需要**过验证码、Turnstile、伪造 TLS 指纹、复用浏览器 `cf_clearance`** 的方案：不写、不建议、不做兜底。

### 4.3 替代方案

1. **只显示 API 余额**（现状）：DeepSeek、Moonshot/Kimi 开放平台、new-api 中转余额；这些是官方/站点 API，风险最低。订阅用户本来就多数同时有 API 余额可看。
2. **订阅额度用「手动卡片」**：插件加一个 `preset='manual'` 的服务（名称 + 用户自己填的数字/文字 + 上次更新时间），用户每月手动改一次。零凭证、零风险，能解决「一眼看到还剩多少」的 80% 需求。
3. **深链到官方用量页**：卡片上放「打开官方用量页」的说明文字。已确认的路径只有 Perplexity `/account/usage`（其接口 Referer 就是它）、Gemini `gemini.google.com/usage`（CodexBar PR 提到「Usage limits 页」）；Claude / ChatGPT / Cursor 的具体设置页路径**未确认**，建议写「在设置里找 Usage / 用量」而不写死 URL。App 是否支持从视图里直接打开外部 URL 也**未确认**（[recon.md](../recon.md) 没写 action 能开链接）；不支持就只写文案。
4. **用户自建聚合层**（进阶，可选写进文档）：用户在自己的电脑/NAS 上跑一个小服务，用官方/半官方方式取数，插件只把「自定义服务」指向它。好处是 cookie/OAuth 不落手机、可自行刷新；但**不改变各平台的 ToS 判断**，不能拿它当「合规洗白」。
5. **官方 API 用量报表**（不是余额）：OpenAI / Anthropic 的组织级 usage/cost API 需要 Admin key、面向组织，个人订阅用不上；**未确认**个人开发者是否可用，暂不建议写进规格。

### 4.4 给 UI 的文案建议

- 订阅类服务不要叫「余额」，叫「套餐剩余」；
- 非官方接口的模板统一加「实验性，接口可能随时变」；
- 明确写「凭证只存本机 `~/.dsh/cache/...`，但会话 cookie 等同于账号登录态，泄露风险高，建议优先用 API key」。

---

## 5. 未确认清单（不要当事实）

- Claude 网页 API 在 Node `fetch` 下是否必然 403（只确认了「换进程/子进程会 403、cf_clearance 与 TLS 指纹绑定」）。
- ChatGPT `wham/usage` 从 Node 直连是否被 Cloudflare 拦。
- Gemini 网页 `getUsageInfo` 的精确 RPC URL/参数（只知道响应结构）。
- GitHub Copilot：个人 Pro/Pro+ 用本人 fine-grained PAT 能否读 `/users/{self}/settings/billing/premium_request/usage`；AI Credits 时代官方是否提供「剩余」字段。
- Cursor session cookie 的实际有效期。
- Perplexity session cookie 的有效期；AUP 是否点名「读取自身用量」。
- Kimi Code `/coding/v1/usages` 是否对外文档化；Kimi Code API key 是否在所有套餐都可用于该接口。
- Z.ai `/api/monitor/usage/quota/limit` 的官方授权状态与 `type` 参数在各套餐的取值。
- new-api「我的订阅」用户端具体路径与到期时间字段。
- 插件视图能否直接打开外部 URL（决定「深链」替代方案的可行性）。

---

## 6. 主要来源

- Claude 网页用量：[claude-web-usage (npm)](https://www.npmjs.com/package/claude-web-usage)、[Socket 分析（TLS 指纹/403）](https://socket.dev/npm/package/claude-web-usage)、[OmniRoute #3046（cf_clearance）](https://github.com/cheaper-inference/OmniRoute/pull/3046)
- Claude OAuth 用量：[Claude-Code-Usage-Monitor #202](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/202)、[claude-code #42904（24h token）](https://github.com/anthropics/claude-code/issues/42904)
- Claude 条款：[Anthropic Consumer Terms](https://www.anthropic.com/legal/consumer-terms)、[Claude Code legal & compliance](https://code.claude.com/docs/en/legal-and-compliance)、[Maka #3143 引文](https://github.com/apache/maka/issues/3143)、[awesome-ai-gateway 条款记录](https://github.com/cuihuan/awesome-ai-gateway/commit/9c25b72a8ed4b0e4e3f2cfe87094279fb1926cde)
- ChatGPT/Codex：[OpenTokenUsage codex](https://github.com/PowerUserZ/OpenTokenUsage/blob/main/docs/providers/codex.md)、[gptme OpenAI subscription](https://github.com/gptme/gptme/blob/fcd16c63783ddd7fa6666bfd4915ee77705ef7ca/gptme/llm/llm_openai_subscription.py)、[chatgpt token heal](https://github.com/tonydzi/second-brain-starter-kit/blob/master/skills/local-chatgpt-token-heal/SKILL.md)、[CodexBar codex.md](https://github.com/steipete/CodexBar/blob/main/docs/codex.md)
- OpenAI 条款：[Terms of Use](https://openai.com/policies/terms-of-use)、[ConductAtlas 条款摘录](https://conductatlas.com/platform/openai/openai-terms-of-use/provision/CA-P-078686/no-automated-extraction-of-data-or-output/)
- Gemini：[gemini-cli #29796（无公开配额 API）](https://github.com/google-gemini/gemini-cli/issues/29796)、[CodexBar gemini.md](https://github.com/steipete/codexbar/blob/20ada8abf0e4e2267aaa8c7cc9cf891cdf866838/docs/gemini.md)、[CodexBar #4535](https://github.com/steipete/CodexBar/pull/4535)、[Google ToS](https://policies.google.com/terms)
- Copilot：[opencode #768（copilot_internal/user）](https://github.com/anomalyco/opencode/issues/768)、[CodexBar copilot.md](https://github.com/steipete/codexbar/blob/7447bc77c2497323d9c41e40164ce705533493c8/docs/copilot.md)、[Bifrost copilot](https://github.com/maximhq/bifrost/blob/ff2e69f7f0143ab79c9de5258b90bd9c70cf347b/docs/providers/supported-providers/github-copilot.mdx)、[GitHub REST billing/usage](https://docs.github.com/en/rest/billing/usage)、[AI Credits 迁移说明](https://github.com/theopenco/llmgateway/blob/cb90c508bad7d6f20fa4da14e6e56600023949f5/apps/ui/src/content/migrations/github-copilot.md)
- Cursor：[ai-usagebar cursor types](https://docs.rs/ai-usagebar/1.12.0/ai_usagebar/cursor/types/index.html)、[cursorhub](https://pypi.org/project/cursorhub/0.1.1/)、[CodexBar cursor.md](https://github.com/steipete/CodexBar/blob/c917fd0f00d09cd2cc7eb2b666671c39837b2714/docs/cursor.md)、[Admin API 仅 Enterprise](https://www.c1.ai/docs/baton/cursor)、[Cursor AUP](https://cursor.com/cn/acceptable-use-policy)
- Windsurf：[API reference（Enterprise only）](https://docs.windsurf.com/ja/windsurf/accounts/api-reference/api-introduction)、[GetTeamCreditBalance](https://docs.windsurf.com/pt-BR/plugins/accounts/api-reference/get-team-credit-balance)、[api-evangelist 摘要](https://raw.githubusercontent.com/api-evangelist/windsurf/refs/heads/main/apis.yml)
- Perplexity：[CodexBar perplexity.md](https://github.com/steipete/CodexBar/blob/main/docs/perplexity.md)、[Perplexity AUP](https://www.perplexity.ai/zh/hub/legal/aup)
- Kimi：[Kimi API balance 文档](https://platform.kimi.ai/docs/api/balance)、[Kimi Code 订阅说明](https://www.kimi.ai/ru/help/kimi-code/benefits)、[Kimi CLI KLIP-14](https://raw.githubusercontent.com/MoonshotAI/kimi-cli/main/klips/klip-14-kimi-code-oauth-login.md)、[OpenTokenUsage kimi](https://github.com/PowerUserZ/OpenTokenUsage/blob/main/docs/providers/kimi.md)
- Z.ai / GLM：[devpack FAQ](https://docs.z.ai/devpack/faq)、[devpack Team Plan](https://docs.z.ai/devpack/teamplan.md)、[pi-glm-quota](https://www.npmjs.com/package/pi-glm-quota)、[hermes-quota-plugin zai.py](https://github.com/rarf/hermes-quota-plugin/blob/v2.8.2/quota_providers/zai.py)
- new-api：[订阅计划管理](https://docs.newapi.pro/zh/docs/guide/feature-guide/admin/subscription)、[钱包与订阅](https://docs.newapi.ai/ja/docs/guide/feature-guide/user/wallet)、[AnyFast /api/user/self](https://docs.anyfast.ai/zh/guides/system-api/current-user-balance)、[QuotaBar NEWAPI_API](https://github.com/superpung/QuotaBar/blob/main/docs/NEWAPI_API.md)、[new-api 订阅 PR #2808](https://github.com/QuantumNous/new-api/pull/2808)
- 社区聚合工具（交叉验证）：[CodexBar](https://github.com/steipete/CodexBar)、[OpenTokenUsage](https://github.com/PowerUserZ/OpenTokenUsage)、[check-llm-quota](https://pypi.org/project/check-llm-quota/)


---

## 2026-11-13 修正（v2.0 实现时核对源码）

- **new-api 订阅不在 `/api/user/self` 里**：现行 new-api 的 `data` 没有 `subscription_quota` 字段（STA1N 实测 200，返回字段里没有）。订阅走独立路由 `GET /api/subscription/self`（[router/api-router.go](https://github.com/QuantumNous/new-api/blob/main/router/api-router.go)，`middleware.UserAuth`），返回 `{ data: { billing_preference, subscriptions: [{ subscription: { amount_total, amount_used, end_time, status, next_reset_time } }], all_subscriptions } }`；`amount_total` / `amount_used` 是 quota 单位（同 `/api/user/self` 的 `quota`）。
- 插件 v2.0 已按此实现：订阅剩余 = `data.subscriptions[].subscription.amount_total - data.subscriptions[].subscription.amount_used`，用站点单位换算；没有订阅时接口返回空数组，订阅行不显示。
- one-api 旧站没有订阅，也没有 `/api/data/self`；用量只能走 `/api/user/dashboard`（固定近 7 天，按 day+model 聚合的 `request_count`/`quota`/`prompt_tokens`/`completion_tokens`）。
