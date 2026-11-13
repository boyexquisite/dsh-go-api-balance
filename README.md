# dsh-go-api-balance

给 **DSH Go 手机 App** 的原生「API 余额」面板：把任意 HTTP 接口的余额聚到一个面板里。
内置 DeepSeek 官方与 new-api / one-api 中转模板，其余服务完全自定义——填地址、密钥和余额字段路径就行。

- **面板**：总余额、每家服务一行（余额 / 状态 / 更新时间 / 用量）、选中看明细；「添加服务」表单直接填。
- **用量**：每家服务可选配一个「用量」请求（中转站可显示近 7 天 Token 数与请求数）；DeepSeek 官方 API 只有余额，不提供用量。
- **状态条**：输入框上方一行总余额（可在面板里关掉）。
- **鉴权**：Bearer 令牌、自定义请求头、Query 参数、Cookie、Basic、账号密码登录换 token。
- **模板**：DeepSeek 官方 / new-api（one-api）中转 / 自定义；字段路径支持 `data.quota`、`balance_infos[0].total_balance` 这种写法。
- **凭证只在主机**：密钥写本机 `$DSH_HOME/cache/dsh-go-api-balance/config.json`（0600），只用于请求你配的余额接口；不进模型上下文、不写日志、不上传；面板里不回显密钥，只提示「已保存」。
- 零运行时依赖，运行时不读对话内容、不调模型。

## 安装

```sh
dsh plugin --profile web add dsh-go-api-balance
```

装在本机引擎（或 App 连的远程主机）上，App 的「插件」页签 / 全部功能里出现「API 余额」。
需要主机能访问你配的余额接口。

## 上手

1. 打开「API 余额」面板 → 「添加服务」→ 先选服务类型（只有三行，别慌）。
2. 按类型填关键项：
   - **DeepSeek 官方**：只要 API Key（名称/接口/字段全自动）。
   - **new-api / one-api 中转**：站点地址（如 `https://sta1n.ai`）+ 访问令牌；货币符号和乘数按站点调（默认 ¥ / 1，STA1N 是 🍪 / 10）。余额和近 7 天用量都自动读。
   - **自定义**：常用页签填地址/鉴权/密钥/余额路径，其余路径收在「高级」页签。
3. 保存后自动刷新，不用再点「刷新」；以后打开面板也会自动更新。

字段路径写法：`data.quota`、`balance_infos[0].total_balance`、`a[1].b`；可以先用「测试」回显的 JSON 对照着填。

## 内置模板说明

| 模板 | 地址 | 鉴权 | 余额路径 | 换算 |
|---|---|---|---|---|
| DeepSeek | `https://api.deepseek.com/user/balance` | Bearer | `balance_infos[0].total_balance` | 原值 |
| new-api / one-api | `<站点>/api/user/self` | Bearer（站点访问令牌） | `data.quota` | `÷500000 × 乘数` |
| ↑ 的用量 | `<站点>/api/data/self?start_timestamp={7d}&end_timestamp={now}&default_time=day` | 同上 | 数组 `data` 里 `token_used`/`count` 求和 | 原值 |

> new-api 各站货币不同：显示成 `🍪`、`$` 还是 `¥`，按站点后台的「1 元 = N 额度」自己调乘数和符号。

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
