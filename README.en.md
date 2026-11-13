# dsh-go-api-balance

Native **API balance** panel for the DSH Go phone app: balances, usage and subscription quotas from any HTTP endpoint in one place.

- One card per service: name / status / balance / up to 2 usage metrics + 2 details; tap the status row for all details, edit and delete.
- Six templates: DeepSeek, new-api / one-api relay, OpenRouter, OpenAI / Claude spend, OpenCode Go / Command Code, custom.
- Auth: Bearer, custom header, query param, cookie, Basic, or login for a token.
- Credentials stay on the host in `config.json` (0600) and are only sent to endpoints you configure. HTTPS only (loopback excepted), cross-origin redirects blocked, zero dependencies, no telemetry, no background polling.
- Field paths: `data.quota`, `balance_infos[0].total_balance`, `a + b`, `a - b`.

## Install

```sh
dsh plugin --profile web add dsh-go-api-balance
```

## Quick start

1. Open **API balance** → **Add service** → pick a type.
2. Fill in the key or site URL; it refreshes right after saving.
3. Custom requires URL, auth, key and balance path; any other platform can use custom too.

## Templates

| Template | Shows | Credential |
|---|---|---|
| DeepSeek | balance (auto ¥/$) | API key |
| new-api / one-api | balance, 7-day usage, subscription quota | access token |
| OpenRouter | balance, today / month spend | API key |
| OpenAI / Claude spend | month spend and tokens (not a balance) | Admin key |
| OpenCode Go / Command Code | subscription quota / percent | API key |

## Config

- `$DSH_HOME/cache/dsh-go-api-balance/config.json` (0600)
- `results.json` in the same directory (0600)
- Deleting `config.json` clears services and keys; old `.bad-*` / `.tmp` files must be removed by hand.
- Threat model and limits: [SECURITY.md](SECURITY.md).

## Development

```sh
npm test
node /root/.dsh/skills/dsh-go-plugin/kit/bin/check.mjs . --load
```

MIT
