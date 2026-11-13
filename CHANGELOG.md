# Changelog / 更新日志

## 0.7.2

### 中文

- **安全**：`/api/status` 货币识别改成独立小预算并给余额请求预留时间，状态接口挂住也不会把余额拖成「请求超时」；迁移只在 preset 与当前地址同厂商时补 OpenAI/Claude 的用量请求，避免手工/旧配置把中转站密钥发到硬编码厂商域名；`validateProvider` 的 `allowSecretReuse` 默认改为拒绝；3xx 的跨域/跳转过多/缺 Location 分支都会取消 body，宿主自动跟随跳转（`redirected`）会被中止；流式读取改为预分配缓冲区（1 字节 chunk 不再放大内存），并与 abort 竞速。
- **正确性**：保存后旧结果同时从内存和磁盘删除（重启且刷新失败也不会复活旧站余额）；v1/v2 判定改由 view 的 caps 决定（宿主 data 只传 protocol/locale 时不再永远带 rows）；编辑超长旧字段时未改动的字段保存还原原值（不写回截断值），并提示；换站留空密钥失败后保留用户刚填的名称/站点；密钥复用改为「不得出现新的 origin」（删除可选地址不再被卡）；停用服务不再生成空的用量指标；多面板保存后都会收到新数据；后台/手动刷新统一取号，后发起的结果优先；dispose 会中止在途手动请求；preset 表单补「启用」开关，toggle 的 1/on 也认；平台下拉 onChange 会合并 App 带回的未提交字段；自定义「只用量」服务不再被余额路径必填卡住；迁移只做一次（`enriched` 落盘），用户删掉的默认明细不会复活；明细/用量/附加信息标签禁止 `=` 与换行；`formatDay` 支持 YYYYMMDD、纯日期按本地日历、兼容 2001 年前的毫秒；count 不再把 true 显示成 1。
- **清理**：删除 `maskSecret`/`providerToDraft`/`PRESETS`/`presetOptions`/`formatNumber` 等未用工具、一次性查询包装与残留测试设置。
- 测试 354 项全绿、检查器 0 error。

### English

- **Security**: the optional `/api/status` currency probe now has its own small budget with time reserved for the balance request; the OpenAI/Claude migration only adds the extra usage request when the configured URL is on the same vendor origin; `allowSecretReuse` now defaults to deny; every 3xx error branch cancels the body and a host that auto-follows redirects (`redirected`) is aborted; streaming reads use a preallocated buffer (1-byte chunks no longer amplify memory) and race the abort signal.
- **Correctness**: deleting a provider's result on save is now persisted; v1/v2 is decided from the view caps; unchanged over-long edit fields keep their original value on save; a failed secret-reuse save keeps the just-entered name/site; reuse is allowed when no new origin is introduced; disabled services no longer render empty usage metrics; all panels receive new data after a save; background/manual refreshes share a sequence so later-started results win; dispose aborts in-flight manual requests; preset forms gained an enabled toggle and truthy toggles accept 1/on; the platform select onChange merges unsubmitted fields; usage-only custom services are no longer blocked by a required balance path; migration runs once (`enriched` persisted); detail/usage/extra labels reject `=` and newlines; `formatDay` handles YYYYMMDD, local date-only and pre-2001 millisecond timestamps; count no longer renders `true` as 1.
- **Cleanup**: removed unused `maskSecret`/`providerToDraft`/`PRESETS`/`presetOptions`/`formatNumber` helpers, one-off query wrappers, and stale test settings.
- 354 tests green, checker 0 error.

## 0.7.1

### 中文

- **手动刷新与保存并发**：手动刷新期间保存/删除服务，旧结果会被丢弃（按配置版本号），由后台刷新按新配置补一次；之前只有后台刷新做了这个保护。
- **响应更稳**：`Content-Length` 超限时直接取消 body 再报「响应太大」，不把连接挂着；远端返回的货币代码/符号、text/date 明细文本都限制长度（≤200 字符/符号 ≤8），usage 数组最多处理 5000 行，避免恶意或异常接口撑大视图/缓存、拖慢 CPU。
- **编辑旧值截断有提示**：旧配置字段超过表单上限被截断时，表单顶部会提示「有旧字段被截断，保存前请检查」，不再静默。
- 关闭面板时一并收起菜单和删除确认；dispose 后不再 emit 或写状态；清理 `stripEnabled` 等最后的状态条遗留字段和未用代码。
- 测试 338 项全绿、检查器 0 error。

### English

- Fixed a manual-refresh/save race: results from a manual refresh are discarded if the config changed meanwhile (revision check), and a background refresh re-fetches with the new config.
- Hardened response handling: an oversized `Content-Length` cancels the body before reporting "响应太大"; remote currency codes/symbols and text/date detail strings are length-capped (200 chars / 8 chars) and usage rows are capped at 5000, so abnormal endpoints cannot bloat the view/cache or burn CPU.
- Editing a config whose old values exceed the form limits now shows a "values were truncated, check before saving" warning instead of silently clipping.
- Closing the panel also collapses the menu and delete confirmation; `dispose` no longer emits or writes state; removed the last `stripEnabled` remnants and unused code.

## 0.7.0

### 中文

- **安全修复（审计）**：响应体改为 256 KiB 流式上限（gzip 炸弹不再能撑爆宿主内存），3xx 跳转不再读 body；单家服务的所有请求共享一个总超时；坏配置备份 `.bad-*` 立刻收紧到 `0600`、失败分支也收紧目录。
- **换站/换平台不再复用旧密钥**：编辑时改了站点域名、登录/用量/附加地址或平台类型，密钥留空会被拒绝并要求重填，避免把 A 家 key 发给 B 家；登录 token 缓存按密码隔离，保存/删除/销毁时清空。
- **修复后台刷新与保存的竞态**：刷新在途时编辑保存，旧响应会被丢弃，并按新配置补刷一次；只有停用服务时保存启用服务也不会再卡住自动刷新。
- **删除确认校验来源**：多面板/旧视图的确认事件不会删错服务。
- 修复：合并模板切换平台后默认名称/符号不跟着变；停用服务仍显示旧余额/旧错误；自定义服务编辑保存丢明细 `kind`（date/count）和 `balanceOptional`；自定义附加信息 `text/date` 类型字段取不到值；`[]` 通配路径的访问次数加了预算（防 CPU 爆炸）；`*.localhost`/`0.0.0.0` 不再当回环放行 http；极大金额不再输出 `undefined`、`-0.001` 不再显示 `-0.00`；日期明细支持数字字符串时间戳；编辑预填超长旧值按上限截断；24 家服务时 v2 patch 不再携带 v1 `rows`，避免超 16 KiB。
- **清理死代码**：移除没有入口的输入框上方状态条和「测试」动作/脱敏预览（连带相关文案），面板数据不再下发无用字段。
- 说明：表单 4 KiB 提交上限对全中文长字段仍可能超（App 端硬限制），README 已注明；常见中英混用有测试兜底。

### English

- **Security fixes**: responses are read with a 256 KiB streaming cap (gzip bombs can no longer exhaust host memory), redirect bodies are cancelled instead of read, and all requests for one service share a total timeout; corrupt-config backups (`.bad-*`) are immediately tightened to `0600` and failure paths also harden the directory.
- **No secret reuse across sites/platforms**: if editing changes the site host, login/usage/extra URLs or platform, an empty key is rejected and must be re-entered; login token cache is keyed by password and cleared on save/delete/dispose.
- **Refresh/save race fixed**: an in-flight refresh is discarded when the config changes during it and a fresh refresh is queued; saving an enabled service after only disabled ones no longer wedges auto-refresh.
- **Delete confirmation is source-checked**: a stale panel's confirm can no longer delete a different service.
- Also fixed: default name/symbol when switching merged platforms; disabled cards showing old balance/errors; custom-service edits losing detail `kind` and `balanceOptional`; `text/date` extra fields being dropped; a visit budget for `[]` wildcard paths; `*.localhost`/`0.0.0.0` no longer treated as loopback; `undefined` in huge amounts and `-0.00`; numeric-string timestamps in date details; over-long edit prefill is clipped; v2 patches omit v1 `rows` so 24 services stay under 16 KiB.
- **Dead code removed**: the never-reachable composer strip and the "test" action/redacted preview (plus their strings).
- Note: the app's 4 KiB form-submit cap can still be exceeded by fully Chinese form content (app-side hard limit); README documents it and a mixed-language budget test guards common usage.

## 0.6.0

### 中文

- 每家服务在卡片上多显示最多两条关键明细（原来只有订阅类附加信息），完整列表仍在状态行菜单里。
- **new-api / one-api 中转**：额度接口里多取「累计请求」「用户组」。
- **OpenRouter**：多显示「本周花费」「累计花费」「消费限额」「限额重置」。
- **OpenAI / Claude 花费**：用同一个 Admin key 再请求一次组织用量，多显示本月输入/输出 Token、请求数（Claude 另含缓存读/写 Token）。
- **Command Code**：多显示 5 小时 / 本周已用金额。
- 老配置在加载时自动补齐这些新字段（只补缺，不覆盖用户已有明细）；所有新增信息都只用已有的 API key / 令牌获取，不碰 Cookie 或网页登录态。

### English

- Cards now show up to two key detail rows (previously only subscription extras); the full list stays in the status-row menu.
- **new-api / one-api relay**: also read total requests and the user group from the quota response.
- **OpenRouter**: also show weekly spend, total spend, key limit and limit reset.
- **OpenAI / Claude spend**: reuse the same Admin key for one more organization usage request, adding monthly input/output tokens and request count (Claude also cache read/write tokens).
- **Command Code**: also show 5h and weekly money used.
- Existing saved services are upgraded on load (missing fields only, nothing overwritten); every new field comes from the same API key/token, never from cookies or web sessions.

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
