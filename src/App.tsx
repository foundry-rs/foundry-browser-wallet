import "./App.css";

import { useEffect, useMemo, useRef, useState } from "react";
import { createWalletClient, custom, type Address, type Chain } from "viem";
import { getAddresses, requestAddresses } from "viem/actions";
import {
  mainnet,
  sepolia,
  base,
  baseSepolia,
  optimism,
  optimismSepolia,
  arbitrum,
  arbitrumSepolia,
  polygon,
} from "viem/chains";
import "viem/window";
import { Porto } from "porto";

type WalletKind = "injected" | "porto";

// Known chains for naming/config if we recognize the id
const CHAINS: Chain[] = [
  mainnet,
  sepolia,
  base,
  baseSepolia,
  optimism,
  optimismSepolia,
  arbitrum,
  arbitrumSepolia,
  polygon,
];

const byId = (id: number) => CHAINS.find((c) => c.id === id);

export const App = () => {
  const injectedProvider =
    (typeof window !== "undefined" ? (window as any).ethereum : undefined) ||
    undefined;

  const portoRef = useRef<any>(null);
  const portoProvider = useMemo(() => {
    try {
      if (!portoRef.current) portoRef.current = Porto.create();
      return portoRef.current.provider;
    } catch {
      return undefined;
    }
  }, []);

  const [walletKind, setWalletKind] = useState<WalletKind>(
    injectedProvider ? "injected" : "porto"
  );
  const provider = walletKind === "injected" ? injectedProvider : portoProvider;

  const [walletChainId, setWalletChainId] = useState<number | undefined>(
    undefined
  );
  const [walletChain, setWalletChain] = useState<Chain | undefined>(undefined);

  const walletClient = useMemo(
    () =>
      provider
        ? createWalletClient({
            chain: walletChain,
            transport: custom(provider),
          })
        : undefined,
    [provider, walletChain]
  );

  const [account, setAccount] = useState<Address>();

  useEffect(() => {
    if (!provider) {
      setAccount(undefined);
      setWalletChainId(undefined);
      setWalletChain(undefined);
      return;
    }

    const onAccountsChanged = (accts: string[]) => {
      setAccount((accts?.[0] as Address) || undefined);
    };

    const onChainChanged = (hex: string) => {
      const id = parseInt(hex, 16);
      setWalletChainId(id);
      setWalletChain(byId(id));
    };

    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("chainChanged", onChainChanged);

    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [provider]);

  useEffect(() => {
    (async () => {
      if (!provider) return;

      try {
        const hex = await provider.request({ method: "eth_chainId" });
        const id = parseInt(hex as string, 16);
        setWalletChainId(id);
        setWalletChain(byId(id));
      } catch {
        setWalletChainId(undefined);
        setWalletChain(undefined);
      }

      if (walletClient) {
        try {
          const addrs = await getAddresses(walletClient);
          setAccount((addrs?.[0] as Address) || undefined);
        } catch {
          setAccount(undefined);
        }
      }
    })();
  }, [provider, walletClient]);

  const connect = async () => {
    if (!walletClient) return;

    const addrs = await requestAddresses(walletClient);
    setAccount(addrs[0] as Address);

    try {
      const hex = await provider!.request({ method: "eth_chainId" });
      const id = parseInt(hex as string, 16);
      setWalletChainId(id);
      setWalletChain(byId(id));
    } catch {}
  };

  const disconnect = async () => {
    setAccount(undefined);

    try {
      await walletClient?.transport.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch {}
  };

  const injectedAvailable = !!injectedProvider;
  const portoAvailable = !!portoProvider;
  const providerAvailable = !!provider;

  return (
    <div className="container">
      <h1>Foundry</h1>

      <label style={{ display: "block", marginBottom: 8 }}>
        Wallet:&nbsp;
        <select
          value={walletKind}
          onChange={(e) => setWalletKind(e.target.value as WalletKind)}
        >
          <option value="injected" disabled={!injectedAvailable}>
            Injected {injectedAvailable ? "" : "(not detected)"}
          </option>
          <option value="porto" disabled={!portoAvailable}>
            Porto {portoAvailable ? "" : "(unavailable)"}
          </option>
        </select>
      </label>

      {account && (
        <div style={{ marginBottom: 12 }}>
          Wallet chain:{" "}
          <b>
            {walletChain
              ? `${walletChain.name} (${walletChainId ?? "unknown"})`
              : ""}
          </b>
        </div>
      )}

      {account ? (
        <>
          <div style={{ marginBottom: 8 }}>Connected: {account}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={disconnect}>Disconnect</button>
          </div>
        </>
      ) : (
        <button onClick={connect} disabled={!providerAvailable}>
          {providerAvailable ? "Connect Wallet" : "No Provider Available"}
        </button>
      )}
    </div>
  );
};
