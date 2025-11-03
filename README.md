# Browser wallet

Interface for interacting with Foundry from the browser.

### Development

```
curl -fsSL https://get.pnpm.io/install.sh | sh - # Install pnpm
pnpm install # Install dependencies
pnpm dev # Start interface on a development server
```

When running Foundry pass the `--browser-disable-open` and `--browser-development` flags.

The `--browser-development` flag disables certain security policies allowing you to connect from `localhost:5173`, the port selected by Vite.