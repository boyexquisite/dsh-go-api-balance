# dsh-go-api-balance

给 DSH Go 手机 App 的原生「API 余额」面板：把任意 HTTP 接口的余额、用量和订阅额度聚到一个面板。

- 一家一张卡片：名称 / 状态 / 余额 / 最多 2 条用量 + 2 条明细；点状态行看全部明细、编辑、删除。
- 6 类模板：DeepSeek、new-api / one-api 中转、OpenRouter、OpenAI / Claude 花费、OpenCode Go / Command Code、自定义。
- 鉴权：Bearer、自定义请求头、Query、Cookie、Basic、登录换 token。
- 凭证只存本机 `config.json`（0600），只用于你配置的接口；只走 https（本机 localhost 例外），跨域跳转拦截；零依赖、无遥测、无后台轮询。
- 字段路径：`data.quota`、`balance_infos[0].total_balance`、`a + b`、`a - b`。

## 安装

```sh
dsh plugin --profile web add dsh-go-api-balance
```

## 上手

1. 打开「API 余额」→「添加服务」→ 选类型。
2. 按提示填 key 或站点地址，保存后自动刷新。
3. 自定义类型需自己填地址、鉴权、密钥、余额路径；其余平台也能用自定义接入。

## 模板

| 模板 | 显示 | 凭证 |
|---|---|---|
| DeepSeek | 余额（¥/$ 自动） | API Key |
| new-api / one-api | 余额、近 7 天用量、订阅额度 | 系统访问令牌 |
| OpenRouter | 余额、今日 / 本月花费 | API Key |
| OpenAI / Claude 花费 | 本月花费与 Token（不是余额） | Admin key |
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
