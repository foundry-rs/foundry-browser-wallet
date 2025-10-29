import "./styles/App.css";

import { Porto } from "porto";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Address, type Chain, createWalletClient, custom } from "viem";
import { getAddresses, requestAddresses, waitForTransactionReceipt } from "viem/actions";
import {
  applyChainId,
  ensureChainSelected,
  readPendingChainId,
  getChainById,
} from "./utils/helpers.ts";
import type {
  ApiErr,
  ApiOk,
  EIP1193,
  EIP6963AnnounceProviderEvent,
  EIP6963ProviderInfo,
  PendingAny,
} from "./utils/types.ts";
import { api, pick, readAddr, renderJSON } from "./utils/api.ts";

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
  const [lastTxReceipt, setLastTxReceipt] = useState<any | null>(null);
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
      const ok = resp && (resp as ApiOk<any>).status === "ok";
      const data = ok ? (resp as ApiOk<any>).data : null;

      const serverConnected = !!data?.connected;
      const serverAccount = (data?.account as string | undefined)?.toLowerCase();
      const serverChainId = data?.chainId as number | undefined;

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

    let tx = pending;

    try {
      const targetChainId = readPendingChainId(tx) ?? chainId;
      await ensureChainSelected(selected.provider, targetChainId, chainId);
      const desiredChain =
        chain ?? (targetChainId != null ? getChainById(targetChainId) : undefined);
      if (!desiredChain) throw new Error("No chain metadata available");

      try {
        const raw = await selected.provider.request<string>({ method: "eth_chainId" });
        applyChainId(raw, setChainId, setChain);
      } catch {}

      const { readHex } = await import("./utils/api.ts");
      const from =
        (account as `0x${string}` | undefined) ??
        (readAddr(tx, "from", "sender") as `0x${string}` | undefined);
      if (!from) throw new Error("No sender account available");

      const serverFrom = readAddr(tx, "from", "sender");
      if (serverFrom && account && serverFrom.toLowerCase() !== account.toLowerCase()) {
        throw new Error(`Server 'from' (${serverFrom}) != connected (${account})`);
      }

      const to = readAddr(tx, "to");
      const value = pick(readHex(tx, "value", "amount"));
      const data = pick(readHex(tx, "data", "input", "calldata"));
      const gas = pick(readHex(tx, "gas", "gasLimit"));
      const gasPrice = pick(readHex(tx, "gasPrice"));
      const maxFeePerGas = pick(readHex(tx, "maxFeePerGas"));
      const maxPriorityFeePerGas = pick(readHex(tx, "maxPriorityFeePerGas"));
      const nonce = tx.nonce as number | undefined;

      const params: any = { account: from, to, value, data, gas, nonce };
      if (gasPrice) params.gasPrice = gasPrice;
      else if (maxFeePerGas || maxPriorityFeePerGas) {
        params.maxFeePerGas = maxFeePerGas;
        params.maxPriorityFeePerGas = maxPriorityFeePerGas;
      }

      const lastHash = await walletClient.sendTransaction({
        ...params,
        chain: desiredChain,
      });
      console.log("tx sent:", { id: tx.id, hash: lastHash });
      setLastTxHash(lastHash);

      const lastReceipt = await waitForTransactionReceipt(walletClient, { hash: lastHash });
      console.log("tx receipt:", lastReceipt);
      setLastTxReceipt(lastReceipt);

      await api("/api/transaction/response", "POST", { id: tx.id, hash: lastHash, error: null });
      await pollTick();
    } catch (e: any) {
      console.log("send failed:", String(e?.message ?? e));

      try {
        await api("/api/transaction/response", "POST", {
          id: tx!.id,
          hash: null,
          error: String(e?.message ?? e),
        });
      } catch {}
      await pollTick();
    }
  };

  const resetClientState = async () => {
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
  };

  useEffect(() => {
    if (selectedUuid) resetClientState();
  }, [selectedUuid]);

  useEffect(() => {
    if (providers.length === 1 && !selected) {
      setSelectedUuid(providers[0].info.uuid);
    }
  }, [providers, selected]);

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

  useEffect(() => {
    pollTick();

    if (!pollRef.current) pollRef.current = window.setInterval(pollTick, 1000);

    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
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

        {selected && account && (<>
          <div className="section-title">Connected</div>
          <pre className="box">
            {`\
account: ${account}
chain:   ${chain ? `${chain.name} (${chainId})` : (chainId ?? "unknown")}
rpc:     ${chain?.rpcUrls?.default?.http?.[0] ?? chain?.rpcUrls?.public?.http?.[0] ?? "unknown"}`}
          </pre>
        </>)}

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
