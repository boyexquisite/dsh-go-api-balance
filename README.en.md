# dsh-go-api-balance

Native **API balance** panel for the **DSH Go** phone app: collect the balances of any HTTP
endpoint into one panel. Templates for DeepSeek and new-api / one-api relays; everything else
is a custom "service": URL + key/token + JSON field paths.

- **Panel**: total, one row per service (balance / status / updated / usage), details, add-service form.
- **Usage**: an optional second request per service (new-api relays can show the last 7 days' token and request counts); DeepSeek's public API has no usage endpoint.
- **Status strip**: one line with the total above the composer (can be turned off).
- **Auth**: Bearer token, custom header, query param, cookie, Basic, or username/password login that trades for a token.
- **Credentials stay on the host** in `$DSH_HOME/cache/dsh-go-api-balance/config.json` (0600); never sent to the model or logged; the panel never echoes the key, it only says it is saved.
- Zero runtime dependencies; no network until the panel is opened or a button is pressed.

## Install

```sh
dsh plugin --profile web add dsh-go-api-balance
```

The host must be able to reach the balance endpoints you configure.

## Quick start

1. Open **API balance** → **Add service** → pick a type (three rows only).
2. Fill just the key fields — **DeepSeek** (API key), **new-api / one-api relay** (site URL, access
   token, currency symbol and multiplier), or **custom** (URL/auth/balance path in "Common",
   the rest under "Advanced").
3. It refreshes right after saving; opening the panel refreshes too.

Field paths look like `data.quota` or `balance_infos[0].total_balance`; the **Test** button
returns the raw JSON so you can check the path.

## Development

```sh
npm test
node /root/.dsh/skills/dsh-go-plugin/kit/bin/check.mjs . --load
```

Contract: [`docs/spec.md`](docs/spec.md). MIT.
