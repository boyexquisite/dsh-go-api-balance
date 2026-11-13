# dsh-go-api-balance

Native **API balance** panel for the **DSH Go** phone app: collect the balances of any HTTP
endpoint into one panel. Six mainstream templates (DeepSeek, new-api / one-api relay, OpenRouter,
OpenAI / Claude spend, OpenCode Go / Command Code, custom); everything else is a custom
"service": URL + key/token + JSON field paths.

- **Panel**: one card per service (name / balance / two large usage metrics / status). The chevron
  opens a menu with edit / delete and details (top-up, gift, subscription). No grand total, since
  sites use different currencies.
- **Usage**: an optional second request per service (relays show the last 7 days' tokens and
  requests; OpenRouter shows today's and this month's spend).
- **Subscriptions**: for new-api sites the plugin also reads `/api/subscription/self` and shows the
  remaining amount and expiry on the card, plus total/used in the menu. Hidden when absent.
- **Units**: new-api / one-api sites are detected from the public `/api/status`
  (`quota_per_unit`, custom currency symbol and rate); DeepSeek follows the returned `currency`.
- **Auth**: Bearer token, custom header, query param, cookie, Basic, or username/password login
  that trades for a token.
- **Credentials stay on the host** in `$DSH_HOME/cache/dsh-go-api-balance/config.json` (0600);
  never sent to the model or logged; the panel never echoes the key.
- **HTTPS only** for credential-bearing URLs (loopback excepted); cross-origin redirects are
  blocked so a key can never be bounced to another host. See [SECURITY.md](SECURITY.md).
- Zero runtime dependencies; no network until the panel is opened or a button is pressed.

## Install

```sh
dsh plugin --profile web add dsh-go-api-balance
```

The host must be able to reach the balance endpoints you configure.

## Quick start

1. Open **API balance** → **Add service** → pick a type.
2. Fill just the key fields:
   - **DeepSeek**: API key only.
   - **new-api / one-api relay**: pick the site type, then site URL (with or without `/v1`) +
     access token; balance, 7-day usage and subscriptions load automatically, currency is
     auto-detected (older one-api uses `/api/user/dashboard` for usage).
   - **OpenRouter**: API key only.
   - **OpenAI / Claude spend**: pick the platform, then organization Admin key; monthly spend only,
     not a balance.
   - **OpenCode Go / Command Code**: pick the platform, then API key only; subscription quota.
   - **Custom**: URL/auth/balance path in "Common", the rest under "Advanced".
3. It refreshes right after saving; opening the panel refreshes too.

Field paths look like `data.quota` or `balance_infos[0].total_balance`, and simple arithmetic is
supported: `a + b`, `a - b` (e.g. cash + gift, subscription total - used).

## Supported platforms

| Template | Shows | Endpoint | Credential |
|---|---|---|---|
| DeepSeek | balance (auto ¥/$), top-up, gift | `GET /user/balance` | API key |
| new-api / one-api relay | new-api: balance, used quota, 7-day tokens/requests, subscription remaining/total/used/expiry; older one-api: balance, used quota, 7-day tokens/requests | `/api/user/self`, `/api/data/self` (legacy `/api/user/dashboard`), `/api/subscription/self`, `/api/status` | access token |
| OpenRouter | remaining limit (— when no key limit), today and month spend | `/api/v1/key` | API key |
| OpenAI / Claude spend | month spend only (Claude is an official estimate, not a balance) | `/v1/organization/costs` / `/v1/organizations/cost_report` | org Admin key / Admin key |
| OpenCode Go / Command Code | subscription quota: 5h/window remaining % (OpenCode), weekly/monthly remaining %, resets; or Command Code monthly credits left and 5h/weekly money left | `/zen/go/v1/usage` / `/alpha/billing/credits` | respective API key |

Custom-only (no built-in template, endpoints not officially documented / unstable): Zhipu GLM,
SiliconFlow (reported retired 2026-08), ModelScope magicubes, MiniMax M Plan, Ace Data.

Not supported: consumer subscriptions (Claude Pro/Max, ChatGPT Plus, Gemini Advanced, Cursor,
Perplexity Pro) — no official API and automation is against their terms; platforms with no
balance/spend API (Gemini API, Cohere, Groq, Replicate, HuggingFace, xAI); prepaid Claude/OpenAI
balances (console only).

## Security & privacy

No conversation/clipboard/file access, no model calls, no telemetry, no background polling,
zero runtime dependencies and no install scripts. Requests only go to the endpoints you configure;
`/api/status` (currency detection) is unauthenticated. Config/cache files are 0600 / dir 0700 and
are tightened on load. What it can and cannot protect against is documented in
[SECURITY.md](SECURITY.md).

## Development

```sh
npm test
node /root/.dsh/skills/dsh-go-plugin/kit/bin/check.mjs . --load
```

Contract: [`docs/spec.md`](docs/spec.md). MIT.
