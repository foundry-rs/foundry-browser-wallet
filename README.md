# Browser wallet

> [!IMPORTANT]
> This repository is deprecated. The browser wallet is now maintained as part of
> [`foundry-wallets`](https://github.com/foundry-rs/foundry-core/tree/main/crates/wallets/src/wallet_browser/app/src).
> Please open new issues and pull requests in
> [`foundry-rs/foundry-core`](https://github.com/foundry-rs/foundry-core).

Interface for interacting with Foundry from the browser.

### Development

```
curl -fsSL https://get.pnpm.io/install.sh | sh - # Install pnpm
pnpm install # Install dependencies
pnpm dev # Start interface on a development server
```

When running Foundry pass the `--browser-disable-open` and `--browser-development` flags.

The `--browser-development` flag disables certain security policies allowing you to connect from `localhost:5173`, the port selected by Vite.
