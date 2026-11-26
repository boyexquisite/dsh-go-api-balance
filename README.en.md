# dsh-go-api-balance

Native **API balance** panel for the DSH Go phone app: balances, usage and subscription quotas from any HTTP endpoint in one place.

- One card per service: name / status / balance / up to 2 usage metrics + 2 details; tap the status row for all details, edit and delete.
- Eight template groups: DeepSeek, new-api / one-api relay, OpenRouter, AIHubMix, OpenAI / Claude spend, Codex subscription, OpenCode Go / Command Code, custom.
- Auth: Bearer, custom header, query param, cookie, Basic, or login for a token.
- User-entered credentials stay on the host in `config.json` (0600); Codex reuses the DSH credential store without copying its token. HTTPS only (loopback excepted), cross-origin redirects blocked, zero dependencies, no telemetry, no background polling.
- Field paths: `data.quota`, `balance_infos[0].total_balance`, `a + b`, `a - b`.

## Install

```sh
dsh plugin --profile web add dsh-go-api-balance
```

## Quick start

1. Open **API balance** → **Add service** → pick a type.
2. Fill in the key or site URL; it refreshes right after saving.
3. Custom requires URL, auth, key and balance path; any other platform can use custom too.
4. The AIHubMix preset requires a **Manage Key / system access token**, not the `sk-` model API key. It shows USD balance, cumulative spend and cumulative requests, not daily/monthly usage. Requests must use your own exact-path balance proxy route.
5. The Ace Data Cloud preset requires the **console email + password** (not a model API key); the plugin logs in to obtain a token. The password is only stored in the local `config.json`.
6. The Codex preset reuses the existing DSH `openai-codex` sign-in; no key is needed. It only reads quota from `chatgpt.com` and never writes the OAuth token to this plugin's config.

## Templates

| Template | Shows | Credential |
|---|---|---|
| DeepSeek | balance (auto ¥/$) | API key |
| Ace Data Cloud | credits balance, cumulative spend, 7-day calls/spend | console email + password (not an API key) |
| new-api / one-api | balance, 7-day usage, subscription quota | access token |
| OpenRouter | balance, today / month spend | API key |
| AIHubMix | USD balance, cumulative spend and requests | Manage Key (not the `sk-` API key; cumulative totals only) |
| OpenAI / Claude spend | month spend and tokens (not a balance) | Admin key |
| Codex subscription | 5-hour / weekly remaining percentages and resets | Existing DSH `openai-codex` OAuth (token not copied) |
| OpenCode Go / Command Code | subscription quota / percent | API key |

## Config

- `$DSH_HOME/cache/dsh-go-api-balance/config.json` (0600)
- `results.json` in the same directory (0600)
- Delete `config.json` to remove services and credentials. Old `.bad-*` / `.tmp` backups must be removed manually.
- Security boundaries: see [SECURITY.md](SECURITY.md).

## Development

```sh
npm test
node /root/.dsh/skills/dsh-go-plugin/kit/bin/check.mjs . --load
```

MIT
