# pi-glm-usage

A [pi](https://github.com/earendil-works/pi-mono) extension that shows your **GLM Coding Plan** usage and next-reset countdown in the footer status bar.

## Features

- 📊 Shows both the **5-hour rolling window** and **weekly window** usage (% + reset countdown)
- 🎨 Color-coded by usage: 🟢 green `<30%` · default · 🟠 orange `≥70%` · 🔴 red `≥90%`
- ⚙️ Zero-config — auto-detects your GLM API key from pi's configured providers
- 🌐 Works with Zhipu domestic (`open.bigmodel.cn`) and international (`api.z.ai`)

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

## Config

Edit `extensions/glm-usage.ts` top constants:

- `POLL_INTERVAL_MS` — refresh interval (default 3 min)
- `VIVID` — colors (truecolor hex)
- thresholds in `colorForPct` (default 30 / 70 / 90)

The extension is a single self-contained file with no external type imports.

## Requirements

- A configured GLM provider in pi (Zhipu/GLM Coding Plan API key)

## License

MIT
