# pi-glm-usage

A [pi](https://github.com/earendil-works/pi-mono) extension that shows your **GLM Coding Plan** usage and next-reset countdown in the footer status bar.

## Features

- 📊 Shows both the **5-hour rolling window** and **weekly window** usage (% + reset countdown)
- 🎨 Color-coded by usage: 🟢 green `<30%` · default · 🟠 orange `≥70%` · 🔴 red `≥90%`
- ⚙️ Zero-config — auto-detects your GLM API key from pi's configured providers
- 🌐 Works with Zhipu domestic (`open.bigmodel.cn`) and international (`api.z.ai`); also auto-detects GLM behind a local proxy (e.g. Headroom) — see [How it works](#how-it-works)

Example footer line:

```
GLM lite  │  5h 69% · 3h3m 后刷新  │  周 28% · 3d 后刷新
```

## Install

From GitHub:

```bash
pi install git:github.com/caimaoy/pi-glm-usage
```

Or add to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["git:github.com/caimaoy/pi-glm-usage"]
}
```

Then `/reload` in pi (or restart). The status shows up in the footer once a GLM provider is configured.

> Replace `caimaoy` with the actual GitHub owner if you fork.

## How it works

Queries Zhipu's internal quota endpoint `GET /api/monitor/usage/quota/limit` with your Coding Plan API key (note: **no `Bearer ` prefix**). The endpoint and response shape follow the production implementation in [cc-switch](https://github.com/farion1231/cc-switch) (`src-tauri/src/services/coding_plan.rs`).

The 5h / weekly windows are distinguished by the `unit` field (`3` = 5h rolling, `6` = weekly). Colors use truecolor ANSI so they render vividly regardless of theme.

**Proxy / headroom setups:** If your GLM provider points at a local proxy (e.g. `http://127.0.0.1:8787`) instead of Zhipu directly, the extension still works — it recognizes the provider by **name + key shape** and queries Zhipu's quota endpoint **directly** with your key (the request goes to `open.bigmodel.cn`, not your proxy). This is required because the quota endpoint isn't exposed by OpenAI-compatible proxies. Note: this means your key is sent to Zhipu's own infra for the quota lookup even when you route model traffic through a proxy.

## Config

Edit `extensions/glm-usage.ts` top constants:

- `POLL_INTERVAL_MS` — refresh interval (default 3 min)
- `VIVID` — colors (truecolor hex)
- thresholds in `colorForPct` (default 30 / 70 / 90)
- `DEFAULT_GLM_HOST` — fallback host for proxy setups. Defaults to the domestic site `https://open.bigmodel.cn`; international (`api.z.ai`) users can override it with the `GLM_QUOTA_HOST` env var (e.g. `GLM_QUOTA_HOST=https://api.z.ai`). Direct connections are unaffected and always use the host from the provider's `baseUrl`.
- `GLM_PROVIDER_NAME_RE` / `GLM_KEY_RE` — heuristics that recognize a GLM provider behind a proxy; both must match for the proxy fallback to fire.

The extension is a single self-contained file with no external type imports.

## Requirements

- A configured GLM provider in pi (Zhipu/GLM Coding Plan API key)

## License

MIT
