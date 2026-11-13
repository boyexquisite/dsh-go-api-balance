# Changelog / 更新日志

## 0.5.0

### 中文

- 「添加服务」精简成 **6 种主流模板**：DeepSeek 官方、new-api / one-api 中转、OpenRouter、OpenAI / Claude 花费、OpenCode Go / Command Code、自定义；Kimi、小米 MiMo 等旧模板不再出现在列表里（老配置仍能正常显示和编辑保存）。
- 合并组在表单里多一个「平台 / 站点类型」下拉：中转组选 new-api 或 one-api 旧站，花费组选 OpenAI 或 Claude，订阅组选 OpenCode Go 或 Command Code；保存按所选平台写入对应配置。
- 修中转组切换站点类型时货币符号沿用另一个模板默认值的问题（one-api 旧站现在会正确回落到 `$`）。

### English

- The add-service list is now **six mainstream templates**: DeepSeek, new-api / one-api relay, OpenRouter, OpenAI / Claude spend, OpenCode Go / Command Code, and custom. Kimi and Xiaomi MiMo are gone from the list (existing saved services still display and edit fine).
- Merged templates add a "platform / site type" dropdown: new-api or legacy one-api, OpenAI or Claude, OpenCode Go or Command Code; saving writes the selected platform.
- Fixed the relay group keeping the other template's currency symbol when switching site types (legacy one-api now correctly falls back to `$`).

## 0.4.3

### 中文

- 卡片美化：服务商名称改为**加粗紫色**（浅色主题自动校正为亮紫 `#7E53DF`，深色主题 `#AB88F8`），一眼能分清哪家。
- 因为 App 的列表行标题不能上色，名称改成独立文本节点；「编辑 / 删除」菜单的入口从名称行挪到**状态行**（点「成功 · 12:06 ›」这一行展开，箭头位置不变在右侧）；表单打开时状态行不可点。

### English

- Card polish: provider names are now **bold purple** (the app corrects to `#7E53DF` in light theme and `#AB88F8` in dark theme), so each card is easier to tell apart.
- List-row titles cannot be coloured, so the name became a standalone text node; the edit/delete menu now opens from the **status row** (`成功 · 12:06 ›`) instead of the name row, keeping the chevron on the right. The status row is not tappable while the form is open.

## 0.4.2

### 中文

- 修「添加服务」只能展开、没法收起：类型列表下面新增「取消」；类型列表展开时再点一次「添加服务」也是收起；关闭面板后类型列表自动收起，重新打开直接看卡片，不再一直挂着一长列模板。

### English

- Fix the "Add service" flow getting stuck open: the template list now has a Cancel button, tapping Add service again collapses it, and closing the panel also collapses it so reopening shows the cards instead of a long template list.

## 0.4.1

### 中文

- 内部整理：路径分词改用 `matchAll`，安全扫描不再把正则匹配误判成「执行 shell 命令」；功能无变化。

### English

- Internal: the tokenizer uses `matchAll`, so heuristic scanners no longer mistake regex matching for shell execution. No behavior change.

## 0.4.0

### 中文

- 新增两个「编码 Agent 订阅」预设：**OpenCode Go**（官方 `/zen/go/v1/usage`，显示 5h/周/月剩余百分比与重置日期）和 **Command Code**（CLI 使用的 `/alpha/billing/credits`，显示本月剩余额度、5h/周剩余金额、额度与重置时间）。
- 引擎支持数字常量表达式（`100 - usage.rolling.percent`、`cap - used`），`%` 符号后置显示（`48%`）。
- 明细支持 `date` 类型：epoch 秒/毫秒或 ISO 字符串统一显示为 `YYYY-MM-DD`（订阅窗口的 `resetsAt`/`resetAt`）。
- 文档补充订阅类平台的研究结论：OpenDesign 只有网页 Cookie + 两步请求，插件不做。

### English

- Two coding-agent subscription presets: **OpenCode Go** (official `/zen/go/v1/usage`; 5h/weekly/monthly remaining percentages and reset dates) and **Command Code** (the CLI's `/alpha/billing/credits`; monthly credits left, 5h/weekly money left, allowance and resets).
- Expressions now accept numeric constants (`100 - usage.rolling.percent`, `cap - used`), and `%` is rendered as a suffix (`48%`).
- Details support `kind: date`: epoch seconds/milliseconds or ISO strings are shown as `YYYY-MM-DD`.
- Research notes document why OpenDesign is not supported (cookie-only, two-step workspace lookup).

## 0.3.0

### 中文

- 安全加固：余额/登录/用量/附加信息地址强制 https（仅 localhost/127.0.0.1 等本机回环允许 http）。
- 跳转防泄露：关闭自动跳转，手动只跟随同源（协议+域名+端口一致），最多 3 跳；跨域跳转直接停止。
- 配置/缓存读到宽权限会自动收紧为 `0600`、目录 `0700`。
- 自定义服务的「高级」页签新增「附加信息地址 / 字段」，任意 JSON 平台都能配订阅类第二次请求。
- 新增 `SECURITY.md` 和 `test/security.test.js`：零依赖、无安装脚本、无遥测、清单不申请对话/剪贴板权限。

### English

- Security hardening: credential-bearing URLs must be https (loopback http only).
- Redirect protection: manual same-origin redirects, max 3 hops; cross-origin redirects stop immediately.
- Config/cache permissions are tightened to 0600 (dir 0700) on load.
- Custom services gained optional extra-info URL/fields (second request) in the Advanced tab.
- Added `SECURITY.md` and security baseline tests (no deps, no install scripts, no telemetry, no wants).

## 0.2.0

### 中文

- 修正单位与数据：DeepSeek 按返回币种自动切换 ¥/$；小米 MiMo 余额改为「现金 + 赠送」（`total_available` 含授信）；Claude 花费补 `ending_at` + `limit=31`（默认只返回 7 天）；新增「one-api 中转（旧站）」预设（用量走 `/api/user/dashboard`）。
- new-api 订阅改正：现行 new-api 的 `/api/user/self` 不含订阅字段，改为请求 `/api/subscription/self`，显示订阅剩余/总量/已用/到期，老配置自动迁移。
- 引擎支持 `路径 + 路径` / `路径 - 路径` 与 `[]` 通配；卡片结果回来后自动重建视图。

### English

- Unit/data fixes: DeepSeek follows the returned currency; MiMo balance is cash + gift (credit excluded); Claude cost report uses `ending_at` + `limit=31`; new legacy one-api preset using `/api/user/dashboard`.
- new-api subscriptions now come from `/api/subscription/self` (remaining/total/used/expiry); old configs migrate automatically.
- Expressions and `[]` aggregation for paths; the view rebuilds after results arrive.

## 0.1.0

### 中文

- 首个版本：DSH Go 手机 App 原生「API 余额」面板，一家一块卡片；支持 DeepSeek、new-api 中转、Kimi、小米 MiMo、OpenRouter、OpenAI 花费、Claude 花费与完全自定义。
- 鉴权支持 Bearer / 自定义头 / Query / Cookie / Basic / 登录换 token；凭证只存主机 `0600` 文件，不进模型、不写日志。

### English

- First release: a native API-balance panel for the DSH Go phone app, one card per service; presets for DeepSeek, new-api relays, Kimi, Xiaomi MiMo, OpenRouter, OpenAI spend, Claude spend and fully custom services.
- Auth: Bearer, custom header, query, cookie, Basic, or login-for-token; credentials stay in a 0600 file on the host, never sent to the model or logged.
