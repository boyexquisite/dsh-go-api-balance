# dsh-go-api-balance

给 DSH Go 手机 App 的原生「API 余额」面板：把任意 HTTP 接口的余额、用量和订阅额度聚到一个面板。

- 一家一张卡片：名称 / 状态 / 余额 / 最多 2 条用量 + 2 条明细；点状态行看全部明细、编辑、删除。
- 8 类模板：DeepSeek、new-api / one-api 中转、OpenRouter、AIHubMix、OpenAI / Claude 花费、Codex 订阅、OpenCode Go / Command Code、自定义。
- 鉴权：Bearer、自定义请求头、Query、Cookie、Basic、登录换 token。
- 自填凭证只存本机 `config.json`（0600）；Codex 复用 DSH 凭据库，不复制令牌。HTTPS only（本机 localhost 例外），跨域跳转拦截；零依赖、无遥测、无后台轮询。
- 字段路径：`data.quota`、`balance_infos[0].total_balance`、`a + b`、`a - b`。

## 安装

```sh
dsh plugin --profile web add dsh-go-api-balance
```

## 上手

1. 打开「API 余额」→「添加服务」→ 选类型。
2. 按提示填 key 或站点地址，保存后自动刷新。
3. 自定义类型需自己填地址、鉴权、密钥、余额路径；其余平台也能用自定义接入。
4. AIHubMix 预设填 **Manage Key / 系统访问令牌**（不是 `sk-` 模型 API Key），显示美元余额、累计消费和累计请求；累计值不是今日/月度统计。AIHubMix 请求走精确余额代理路由；**接口地址默认填项目作者部署的公共路由（`https://miao233.top/...`，会把 Manage Key 发到该服务器），表单里可改成你自己部署的代理**，介意请替换。
5. Ace Data Cloud 预设填 **控制台邮箱 + 密码**（不是模型 API Key）；插件用它登录换 token，密码只存本机 `config.json`。
6. Codex 预设复用 DSH 里已有的 `openai-codex` 登录，不需要填 key；只向 `chatgpt.com` 查询额度，OAuth 令牌不会写入余额插件配置。

## 模板

| 模板 | 显示 | 凭证 |
|---|---|---|
| DeepSeek | 余额（¥/$ 自动） | API Key |
| Ace Data Cloud | 积分余额、累计消耗、近 7 天调用/消耗 | 控制台邮箱 + 密码（不是 API Key） |
| new-api / one-api | 余额、近 7 天用量、订阅额度 | 系统访问令牌 |
| OpenRouter | 余额、今日 / 本月花费 | API Key |
| AIHubMix | 美元余额、累计消费、累计请求 | Manage Key（不是 `sk-` API Key；累计值非日/月分项） |
| OpenAI / Claude 花费 | 本月花费与 Token（不是余额） | Admin key |
| Codex 订阅额度 | 5 小时 / 周剩余比例、重置时间 | DSH 已登录的 `openai-codex` OAuth（不复制令牌） |
| OpenCode Go / Command Code | 订阅剩余额度 / 百分比 | API Key |

## 配置

- 配置：`$DSH_HOME/cache/dsh-go-api-balance/config.json`（0600）
- 缓存：同目录 `results.json`（0600）
- 删除 `config.json` 即清空服务与密钥；`.bad-*` / `.tmp` 旧文件需手动删。
- 安全边界与已知限制见 [SECURITY.md](SECURITY.md)。

## 开发

```sh
npm test
node /root/.dsh/skills/dsh-go-plugin/kit/bin/check.mjs . --load
```

MIT
