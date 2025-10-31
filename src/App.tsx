import "./styles/App.css";

import { Porto } from "porto";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Address,
  type Chain,
  createWalletClient,
  custom,
  type TransactionReceipt,
} from "viem";
import { waitForTransactionReceipt } from "viem/actions";

import { api, applyChainId, isOk, renderJSON, renderMaybeParsedJSON } from "./utils/helpers.ts";
import type {
  ApiErr,
  ApiOk,
  EIP1193,
  EIP6963AnnounceProviderEvent,
  EIP6963ProviderInfo,
  PendingAny,
  PendingSigning,
} from "./utils/types.ts";

export function App() {
  useEffect(() => {
    if (!window.__PORTO__) {
      window.__PORTO__ = Porto.create();
    }
  }, []);

  const [providers, setProviders] = useState<{ info: EIP6963ProviderInfo; provider: EIP1193 }[]>(
    [],
  );

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [pendingTx, setPendingTx] = useState<PendingAny | null>(null);
  const [pendingSigning, setPendingSigning] = useState<PendingSigning | null>(null);
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const selected = providers.find((p) => p.info.uuid === selectedUuid) ?? null;

  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [chain, setChain] = useState<Chain>();

  const [lastTxReceipt, setLastTxReceipt] = useState<TransactionReceipt | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [lastSignature, setLastSignature] = useState<string | null>(null);

  const pollTxRef = useRef<number | null>(null);
  const pollSigningRef = useRef<number | null>(null);
  const prevSelectedUuidRef = useRef<string | null>(null);

  const connect = async () => {
    if (!selected || confirmed) return;

    const addrs = (await selected.provider.request({
      method: "eth_requestAccounts",
    })) as string[];
    setAccount((addrs?.[0] as Address) ?? undefined);

    try {
      const raw = await selected.provider.request<string>({ method: "eth_chainId" });
      applyChainId(raw, setChainId, setChain);
    } catch {
      setChainId(undefined);
      setChain(undefined);
    }
  };

  // Confirm the current connection.
  // This is required for Foundry to fill out the `from` field and `chain` in transactions.
  const confirm = async () => {
    if (!account || chainId == null) {
      return;
    }

    try {
      await api("/api/connection", "POST", [account, chainId]);
    } catch {
      return;
    }

    setConfirmed(true);
  };

  const signCurrentMessage = async () => {
    if (!selected || !pendingSigning) return;

    const { id, signType, request } = pendingSigning;
    const signer = request.address;
    const msg = request.message;

    try {
      let signature: string;

      switch (signType) {
        case "PersonalSign":
          // Standard message signing
          signature = (await selected.provider.request({
            method: "personal_sign",
            params: [msg, signer],
          })) as string;
          break;

        case "SignTypedDataV4":
          // EIP-712 typed data signing
          signature = (await selected.provider.request({
            method: "eth_signTypedData_v4",
            params: [signer, msg],
          })) as string;
          break;

        default:
          throw new Error(`Unsupported signType: ${signType}`);
      }

      await api("/api/signing/response", "POST", {
        id,
        signature,
        error: null,
      });

      setLastSignature(signature);
      setPendingSigning(null);
    } catch (e: unknown) {
      const errMsg =
        typeof e === "object" &&
        e &&
        "message" in e &&
        typeof (e as { message?: unknown }).message === "string"
          ? (e as { message: string }).message
          : String(e);

      try {
        await api("/api/signing/response", "POST", {
          id,
          signature: null,
          error: errMsg,
        });
      } catch {}

      setLastSignature(null);
      setPendingSigning(null);
    }
  };

  // Sign and send the current pending transaction.
  const signAndSendCurrentTx = async () => {
    if (!selected || !pendingTx?.request) return;

    const walletClient = createWalletClient({
      transport: custom(selected.provider),
      chain: chain ?? undefined,
    });

    try {
      const hash = (await selected.provider.request({
        method: "eth_sendTransaction",
        params: [pendingTx.request],
      })) as `0x${string}`;
      setLastTxHash(hash);

      await api("/api/transaction/response", "POST", { id: pendingTx.id, hash, error: null });

      const receipt = await waitForTransactionReceipt(walletClient, { hash });
      setLastTxReceipt(receipt);
    } catch (e: unknown) {
      const msg =
        typeof e === "object" &&
        e &&
        "message" in e &&
        typeof (e as { message?: unknown }).message === "string"
          ? (e as { message: string }).message
          : String(e);

      console.error("send failed:", msg);

      try {
        await api("/api/transaction/response", "POST", {
          id: pendingTx.id,
          hash: null,
          error: msg,
        });
      } catch {}
    }
  };

  // Reset all client state.
  const resetClientState = useCallback(() => {
    if (pollTxRef.current) {
      window.clearInterval(pollTxRef.current);
      pollTxRef.current = null;
    }

    if (pollSigningRef.current) {
      window.clearInterval(pollSigningRef.current);
      pollSigningRef.current = null;
    }

    setPendingTx(null);
    setPendingSigning(null);
    setLastTxHash(null);
    setLastTxReceipt(null);

    setAccount(undefined);
    setChainId(undefined);
    setChain(undefined);
    setConfirmed(false);

    void api("/api/connection", "POST", null);
  }, []);

  // Upon switching wallets, reset state.
  useEffect(() => {
    if (
      prevSelectedUuidRef.current &&
      selectedUuid &&
      prevSelectedUuidRef.current !== selectedUuid
    ) {
      void resetClientState();
    }

    prevSelectedUuidRef.current = selectedUuid;
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

    const onAccountsChanged = (accounts: readonly string[]) => {
      if (confirmed) return;

      setAccount((accounts[0] as Address) ?? undefined);
    };

    const onChainChanged = (raw: unknown) => {
      if (confirmed) return;

      applyChainId(raw, setChainId, setChain);
    };

    selected.provider.on?.("accountsChanged", onAccountsChanged);
    selected.provider.on?.("chainChanged", onChainChanged);

    return () => {
      selected.provider.removeListener?.("accountsChanged", onAccountsChanged);
      selected.provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [selected, confirmed]);

  // Poll for pending transaction requests.
  // Stops when one is found or when a pending signing request is found.
  useEffect(() => {
    if (!confirmed || pendingTx || pendingSigning) return;

    let active = true;

    const id = window.setInterval(async () => {
      if (!active) return;
      try {
        const resp = await api<ApiOk<PendingAny> | ApiErr>("/api/transaction/request");
        if (isOk(resp)) {
          window.clearInterval(id);
          if (active) {
            setPendingTx(resp.data);
          }
        }
      } catch {}
    }, 1000);

    pollTxRef.current = id;

    return () => {
      active = false;
      window.clearInterval(id);
      if (pollTxRef.current === id) {
        pollTxRef.current = null;
      }
    };
  }, [confirmed, pendingTx, pendingSigning]);

  // Poll for pending signing requests.
  // Stops when one is found or when a pending transaction request is found.
  useEffect(() => {
    if (!confirmed || pendingSigning || pendingTx) return;

    let active = true;

    const id = window.setInterval(async () => {
      if (!active) return;
      try {
        const resp = await api<ApiOk<PendingSigning> | ApiErr>("/api/signing/request");
        if (isOk(resp)) {
          window.clearInterval(id);
          if (active) {
            setPendingSigning(resp.data);
          }
        }
      } catch {}
    }, 1000);

    pollSigningRef.current = id;

    return () => {
      active = false;
      window.clearInterval(id);
      if (pollSigningRef.current === id) {
        pollSigningRef.current = null;
      }
    };
  }, [confirmed, pendingSigning, pendingTx]);

  return (
    <div className="wrapper">
      <div className="container">
        <div className="notice">
          Browser wallet is still in early development. Use with caution!
        </div>

        <img className="banner" src="banner.png" alt="Foundry Browser Wallet" />

        {providers.length > 1 && (
          <div className="wallet-selector">
            <label>
              <select
                value={selectedUuid ?? ""}
                onChange={(e) => setSelectedUuid(e.target.value || null)}
                disabled={confirmed}
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

        {selected && !account && (
          <button type="button" className="wallet-connect" onClick={connect} disabled={confirmed}>
            Connect Wallet
          </button>
        )}

        {selected && account && !confirmed && (
          <button
            type="button"
            className="wallet-confirm"
            onClick={confirm}
            disabled={!account || chainId == null}
          >
            Confirm Connection
          </button>
        )}

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

        {selected &&
          account &&
          confirmed &&
          !pendingTx &&
          !pendingSigning &&
          !lastTxHash &&
          !lastSignature && (
            <>
              <div className="section-title">Transaction To Sign</div>
              <div className="box">
                <pre>No pending transaction or signing request</pre>
              </div>
            </>
          )}

        {selected && account && confirmed && !lastTxHash && pendingTx && (
          <>
            <div className="section-title">Transaction to Sign & Send</div>
            <div className="box">
              <pre>{renderJSON(pendingTx.request)}</pre>
            </div>
            <button type="button" className="wallet-send" onClick={signAndSendCurrentTx}>
              Sign &amp; Send
            </button>
          </>
        )}

        {selected && account && confirmed && !pendingTx && pendingSigning && (
          <>
            <div className="section-title">Message / Data to Sign</div>
            <div className="box">
              <pre>{renderMaybeParsedJSON(pendingSigning.request)}</pre>
            </div>
            <button type="button" className="wallet-send" onClick={signCurrentMessage}>
              Sign
            </button>
          </>
        )}

        {selected && account && lastTxHash && (
          <>
            <div className="section-title">Transaction Hash</div>
            <pre className="box">{lastTxHash}</pre>

            <div>
              <div className="section-title">Receipt</div>
              <pre className="box">
                {lastTxReceipt ? renderJSON(lastTxReceipt) : "Waiting for receipt..."}
              </pre>
            </div>
          </>
        )}

        {selected && account && confirmed && lastSignature && (
          <>
            <div className="section-title">Signature Result</div>
            <pre className="box">{lastSignature}</pre>
          </>
        )}
      </div>
    </div>
  );
}
