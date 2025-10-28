import "./App.css";

import { Porto } from "porto";
import { useEffect, useMemo, useState } from "react";
import { type Address, type Chain, createWalletClient, custom } from "viem";
import { getAddresses, requestAddresses } from "viem/actions";
import * as chains from "viem/chains";

import type { AnnounceEvent, EIP1193, EIP6963ProviderInfo } from "./types.ts";

declare global {
  interface Window {
    __PORTO__?: unknown;
  }
}

const ALL_CHAINS: readonly Chain[] = Object.freeze(Object.values(chains) as Chain[]);

const byId = (id: number) => ALL_CHAINS.find((c) => c.id === id);

export function App() {
  useEffect(() => {
    if (!window.__PORTO__) {
      window.__PORTO__ = Porto.create();
    }
  }, []);

  const [providers, setProviders] = useState<{ info: EIP6963ProviderInfo; provider: EIP1193 }[]>(
    [],
  );

  useEffect(() => {
    const onAnnounce = (e: Event) => {
      const ev = e as AnnounceEvent;
      const { info, provider } = ev.detail;
      setProviders((prev) =>
        prev.some((p) => p.info.uuid === info.uuid) ? prev : [...prev, { info, provider }],
      );
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce as EventListener);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce as EventListener);
    };
  }, []);

  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  useEffect(() => {
    if (providers.length === 1 && !selectedUuid) {
      setSelectedUuid(providers[0].info.uuid);
    }
  }, [providers, selectedUuid]);

  const selected = providers.find((p) => p.info.uuid === selectedUuid) ?? null;

  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [chain, setChain] = useState<Chain>();

  const walletClient = useMemo(
    () =>
      selected
        ? createWalletClient({
            chain,
            transport: custom(selected.provider),
          })
        : undefined,
    [selected, chain],
  );

  useEffect(() => {
    if (!selected) return;

    const onAccountsChanged = (accounts: readonly string[]) =>
      setAccount(accounts?.[0] as Address | undefined);

    const onChainChanged = (hex: string) => {
      const id = Number.parseInt(hex, 16);
      const validId = Number.isFinite(id) ? id : undefined;
      setChainId(validId);
      setChain(validId ? byId(validId) : undefined);
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
        const hex = await selected.provider.request({ method: "eth_chainId" });
        const id = parseInt(hex as string, 16);
        setChainId(id);
        setChain(byId(id));
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
      const hex = await selected.provider.request<string>({
        method: "eth_chainId",
      });
      const id = Number.parseInt(hex, 16);
      setChainId(Number.isFinite(id) ? id : undefined);
      setChain(Number.isFinite(id) ? byId(id) : undefined);
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
chain:  ${chain ? `${chain.name} (${chainId})` : (chainId ?? "unknown")}
rpc:    ${chain?.rpcUrls?.default?.http?.[0] ?? chain?.rpcUrls?.public?.http?.[0] ?? "unknown"}`}
        </pre>
      )}

      {selected &&
        (account ? (
          <>
            <div className="output">Connected: {account}</div>
            <button type="button" className="disconnect" onClick={disconnect}>
              Disconnect
            </button>
          </>
        ) : (
          <button type="button" onClick={connect}>
            Connect Wallet
          </button>
        ))}
    </div>
  );
}
