import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { porto } from "wagmi/connectors";
import { createConfig, http } from "wagmi";
import { mainnet, base } from "wagmi/chains";

import "./styles/reset.css";
import "./styles/global.css";
import "@rainbow-me/rainbowkit/styles.css";

import { App } from "./App.tsx";

const queryClient = new QueryClient();

const config = createConfig({
  chains: [mainnet, base],
  connectors: [porto()],
  transports: {
    [mainnet.id]: http(),
    [base.id]: http(),
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme()}>
          <App />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>
);
