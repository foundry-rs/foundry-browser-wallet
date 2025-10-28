import "./styles/App.css";

import { Porto } from "porto";
import { useEffect, useMemo, useState } from "react";
import { type Address, type Chain, createWalletClient, custom } from "viem";
import { getAddresses, requestAddresses } from "viem/actions";
import { applyChainId } from "./utils/helpers.ts";
import type {
  EIP1193,
  EIP6963AnnounceProviderEvent,
  EIP6963ProviderInfo,
} from "./utils/types.ts";

declare global {
  interface Window {
    __PORTO__?: unknown;
  }
}

export function App() {
  useEffect(() => {
    if (!window.__PORTO__) {
      window.__PORTO__ = Porto.create();
    }
  }, []);

  const [providers, setProviders] = useState<
    { info: EIP6963ProviderInfo; provider: EIP1193 }[]
  >([]);

  useEffect(() => {
    const onAnnounce = (ev: EIP6963AnnounceProviderEvent) => {
      const { info, provider } = ev.detail;

      setProviders((prev) =>
        prev.some((p) => p.info.uuid === info.uuid)
          ? prev
          : [...prev, { info, provider }]
      );
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
    };
  }, []);

  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const selected = providers.find((p) => p.info.uuid === selectedUuid) ?? null;

  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [chain, setChain] = useState<Chain>();

  const walletClient = useMemo(
    () =>
      selected
        ? createWalletClient({
            transport: custom(selected.provider),
          })
        : undefined,
    [selected]
  );

  useEffect(() => {
    if (!selected) return;

    const onAccountsChanged = (accounts: readonly string[]) =>
      setAccount((accounts[0] as Address) ?? undefined);

    const onChainChanged = (raw: unknown) => {
      applyChainId(raw, setChainId, setChain);
    };

    selected.provider.on?.("accountsChanged", onAccountsChanged);
    selected.provider.on?.("chainChanged", onChainChanged);

    return () => {
      selected.provider.removeListener?.("accountsChanged", onAccountsChanged);
      selected.provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [selected]);

  useEffect(() => {
    (async () => {
      if (!selected) return;

      try {
        const raw = await selected.provider.request<string>({
          method: "eth_chainId",
        });
        applyChainId(raw, setChainId, setChain);
      } catch {
        setChainId(undefined);
        setChain(undefined);
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
  }, [selected, walletClient]);

  const connect = async () => {
    if (!walletClient || !selected) return;
    const addrs = (await requestAddresses(walletClient)) as readonly Address[];
    setAccount(addrs[0] as Address | undefined);

    try {
      const raw = await selected.provider.request<string>({
        method: "eth_chainId",
      });
      applyChainId(raw, setChainId, setChain);
    } catch {
      setChainId(undefined);
      setChain(undefined);
    }
  };

  return (
    <div className="container">
      <h1 className="title">Foundry</h1>

      {providers.length > 1 && (
        <div>
          <label>
            <select
              value={selectedUuid ?? ""}
              onChange={(e) => setSelectedUuid(e.target.value || null)}
            >
              <option value="" disabled>
                Select wallet…
              </option>
              {providers.map(({ info }) => (
                <option key={info.uuid} value={info.uuid}>
                  {info.name} ({info.rdns})
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {providers.length === 0 && <p>No wallets found.</p>}

      {selected && account && (
        <pre className="info">
          {`\
chain:  ${chain ? `${chain.name} (${chainId})` : chainId ?? "unknown"}
rpc:    ${
            chain?.rpcUrls?.default?.http?.[0] ??
            chain?.rpcUrls?.public?.http?.[0] ??
            "unknown"
          }`}
        </pre>
      )}

      {selected ? (
        account ? (
          <div className="output">Connected: {account}</div>
        ) : (
          <button type="button" className="connect" onClick={connect}>
            Connect Wallet
          </button>
        )
      ) : (
        <p>Please select a wallet</p>
      )}
    </div>
  );
}
