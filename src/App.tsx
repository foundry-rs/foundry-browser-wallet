import "./App.css";

import { useEffect, useMemo, useState } from "react";
import { createWalletClient, custom, type Address, type Chain } from "viem";
import { getAddresses, requestAddresses } from "viem/actions";
import * as chains from "viem/chains";
import { Porto } from "porto";

import type { EIP6963ProviderInfo, EIP1193, AnnounceEvent } from "./types.ts";

const ALL_CHAINS: Chain[] = Object.values(chains).filter(
  (c: any) =>
    typeof c === "object" &&
    c !== null &&
    "id" in c &&
    typeof (c as any).id === "number"
);
const byId = (id: number) => ALL_CHAINS.find((c) => c.id === id);

export function App() {
  useEffect(() => {
    if (!(window as any).__PORTO__) {
      (window as any).__PORTO__ = Porto.create();
    }
  }, []);

  const [providers, setProviders] = useState<
    { info: EIP6963ProviderInfo; provider: EIP1193 }[]
  >([]);

  useEffect(() => {
    const onAnnounce = (e: Event) => {
      const ev = e as AnnounceEvent;
      const { info, provider } = ev.detail;
      setProviders((prev) =>
        prev.some((p) => p.info.uuid === info.uuid)
          ? prev
          : [...prev, { info, provider }]
      );
    };

    window.addEventListener(
      "eip6963:announceProvider",
      onAnnounce as EventListener
    );
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    return () => {
      window.removeEventListener(
        "eip6963:announceProvider",
        onAnnounce as EventListener
      );
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
    [selected, chain]
  );

  useEffect(() => {
    if (!selected) return;

    const onAccountsChanged = (accts: string[]) =>
      setAccount((accts?.[0] as Address) || undefined);

    const onChainChanged = (hex: string) => {
      const id = parseInt(hex, 16);
      setChainId(id);
      setChain(byId(id));
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
    const addrs = await requestAddresses(walletClient);
    setAccount(addrs[0] as Address);

    try {
      const hex = await selected.provider.request({ method: "eth_chainId" });
      const id = parseInt(hex as string, 16);
      setChainId(id);
      setChain(byId(id));
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
      <h1>Foundry</h1>

      {providers.length > 1 && (
        <div style={{ marginBottom: 8 }}>
          <label>
            Wallet:&nbsp;
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

      {providers.length === 0 && <p>No EIP-6963 wallets found.</p>}

      {selected && account && (
        <pre
          style={{
            border: "1px solid #e1e4e8",
            borderRadius: 6,
            padding: "8px 12px",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 13,
            lineHeight: 1.5,
            marginBottom: 16,
            whiteSpace: "pre-wrap",
          }}
        >
          {`\
chain:  ${chain ? `${chain.name} (${chainId})` : chainId ?? "unknown"}
rpc:    ${
            chain?.rpcUrls?.default?.http?.[0] ??
            chain?.rpcUrls?.public?.http?.[0] ??
            "unknown"
          }`}
        </pre>
      )}

      {selected && (
        <>
          {account ? (
            <>
              <div style={{ marginBottom: 8 }}>Connected: {account}</div>
              <button onClick={disconnect}>Disconnect</button>
            </>
          ) : (
            <button onClick={connect}>Connect Wallet</button>
          )}
        </>
      )}
    </div>
  );
}
