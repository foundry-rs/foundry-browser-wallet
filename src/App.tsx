import "./styles/App.css";

import { Porto } from "porto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Address,
  type Chain,
  createWalletClient,
  custom,
  type TransactionReceipt,
} from "viem";
import { getAddresses, requestAddresses, waitForTransactionReceipt } from "viem/actions";
import { applyChainId, api, isOk, renderJSON } from "./utils/helpers.ts";
import type {
  ApiErr,
  ApiOk,
  EIP1193,
  EIP6963AnnounceProviderEvent,
  EIP6963ProviderInfo,
  PendingAny,
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

  const [providers, setProviders] = useState<{ info: EIP6963ProviderInfo; provider: EIP1193 }[]>(
    [],
  );
  const [pending, setPending] = useState<PendingAny | null>(null);
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const selected = providers.find((p) => p.info.uuid === selectedUuid) ?? null;

  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [chain, setChain] = useState<Chain>();
  const [lastTxReceipt, setLastTxReceipt] = useState<TransactionReceipt | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);
  const lastPendingIdRef = useRef<string | null>(null);

  const walletClient = useMemo(() => {
    if (!selected) return undefined;
    return createWalletClient({
      transport: custom(selected.provider),
      chain: chain ?? undefined,
    });
  }, [selected, chain]);

  const ensureServerConnected = async () => {
    try {
      const resp = await api<
        ApiOk<{ connected: boolean; account?: string; chainId?: number }> | ApiErr
      >("/api/connection");

      if (!isOk(resp)) return;

      const serverConnected = !!resp.data?.connected;
      const serverAccount = (resp.data?.account as string | undefined)?.toLowerCase();
      const serverChainId = resp.data?.chainId as number | undefined;

      if (!account || chainId == null) {
        if (serverConnected) {
          await api("/api/connection", "POST", null);
        }
      } else {
        if (
          !serverConnected ||
          serverAccount !== account.toLowerCase() ||
          serverChainId !== chainId
        ) {
          await api("/api/connection", "POST", [account, chainId]);
        }
      }
    } catch {}
  };

  const pollTick = async () => {
    await ensureServerConnected();

    try {
      const resp = await api<ApiOk<PendingAny> | ApiErr>("/api/transaction/request");

      if (!resp || (resp as ApiErr).status !== "ok") {
        if (pending) {
          setPending(null);
          lastPendingIdRef.current = null;
        }
      } else {
        const tx = (resp as ApiOk<PendingAny>).data;

        if (!lastPendingIdRef.current || lastPendingIdRef.current !== tx.id) {
          setPending(tx);
          lastPendingIdRef.current = tx.id ?? null;
          setLastTxHash(null);
          setLastTxReceipt(null);
        } else if (!pending) {
          setPending(tx);
        }
      }
    } catch {}
  };

  const connect = async () => {
    if (!walletClient || !selected) return;

    const addrs = (await requestAddresses(walletClient)) as readonly Address[];
    setAccount(addrs[0] as Address | undefined);

    try {
      const raw = await selected.provider.request<string>({ method: "eth_chainId" });
      applyChainId(raw, setChainId, setChain);
    } catch {
      setChainId(undefined);
      setChain(undefined);
    }

    await ensureServerConnected();
  };

  const signAndSendCurrent = async () => {
    if (!walletClient || !selected || !pending) return;

    const tx = pending;

    try {
      const hash = (await selected.provider.request({
        method: "eth_sendTransaction",
        params: [tx.request],
      })) as `0x${string}`;
      setLastTxHash(hash);

      const receipt = await waitForTransactionReceipt(walletClient, { hash });
      setLastTxReceipt(receipt);

      await api("/api/transaction/response", "POST", { id: tx.id, hash, error: null });
      await pollTick();
    } catch (e: unknown) {
      const msg =
        typeof e === "object" &&
        e &&
        "message" in e &&
        typeof (e as { message?: unknown }).message === "string"
          ? (e as { message: string }).message
          : String(e);

      console.log("send failed:", msg);

      try {
        await api("/api/transaction/response", "POST", {
          id: (pending as { id?: string }).id,
          hash: null,
          error: msg,
        });
      } catch {}

      await pollTick();
    }
  };

  const resetClientState = useCallback(async () => {
    setPending(null);
    setLastTxHash(null);
    setLastTxReceipt(null);
    lastPendingIdRef.current = null;

    setAccount(undefined);
    setChainId(undefined);
    setChain(undefined);

    try {
      await api("/api/connection", "POST", null);
    } catch {}
  }, []);

  // Upon switching wallets, reset state.
  useEffect(() => {
    if (selectedUuid) {
      resetClientState();
    }
  }, [selectedUuid, resetClientState]);

  // Auto-select if only one wallet is available.
  useEffect(() => {
    if (providers.length === 1 && !selected) {
      setSelectedUuid(providers[0].info.uuid);
    }
  }, [providers, selected]);

  // Listen for new provider announcements.
  useEffect(() => {
    const onAnnounce = (ev: EIP6963AnnounceProviderEvent) => {
      const { info, provider } = ev.detail;

      setProviders((prev) =>
        prev.some((p) => p.info.uuid === info.uuid) ? prev : [...prev, { info, provider }],
      );
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);

  // Listen for account and chain changes.
  useEffect(() => {
    if (!selected) return;

    const onAccountsChanged = (accounts: readonly string[]) =>
      setAccount((accounts[0] as Address) ?? undefined);
    const onChainChanged = (raw: unknown) => applyChainId(raw, setChainId, setChain);

    selected.provider.on?.("accountsChanged", onAccountsChanged);
    selected.provider.on?.("chainChanged", onChainChanged);
    return () => {
      selected.provider.removeListener?.("accountsChanged", onAccountsChanged);
      selected.provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [selected]);

  // Upon account or chainId change, update state.
  useEffect(() => {
    (async () => {
      if (!selected) return;
      try {
        const raw = await selected.provider.request<string>({ method: "eth_chainId" });
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

  // Polling loop to check for new pending transactions.
  useEffect(() => {
    pollTick();

    if (!pollRef.current) {
      pollRef.current = window.setInterval(pollTick, 1000);
    }

    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
      }

      pollRef.current = null;
    };
  }, [account, chainId, selected]);

  return (
    <div className="wrapper">
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
          <>
            <div className="section-title">Connected</div>
            <pre className="box">
              {`\
account: ${account}
chain:   ${chain ? `${chain.name} (${chainId})` : (chainId ?? "unknown")}
rpc:     ${chain?.rpcUrls?.default?.http?.[0] ?? chain?.rpcUrls?.public?.http?.[0] ?? "unknown"}`}
            </pre>
          </>
        )}

        {selected ? (
          !account && (
            <button type="button" className="connect" onClick={connect}>
              Connect Wallet
            </button>
          )
        ) : (
          <p>Please select a wallet</p>
        )}

        {selected && account && (
          <>
            <div className="section-title">To Sign</div>
            <div className="box">
              <pre>{pending ? renderJSON(pending) : "No pending transaction"}</pre>
            </div>
          </>
        )}

        {selected && account && lastTxHash && (
          <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
            <div>
              <div className="section-title">Transaction Hash</div>
              <pre className="box">{lastTxHash}</pre>

              <div>
                <div className="section-title">Receipt</div>
                <pre className="box">
                  {lastTxReceipt ? renderJSON(lastTxReceipt) : "Waiting for receipt..."}
                </pre>
              </div>
            </div>
          </div>
        )}

        {selected && account && pending && (
          <button type="button" onClick={signAndSendCurrent}>
            Sign & Send
          </button>
        )}
      </div>
    </div>
  );
}
