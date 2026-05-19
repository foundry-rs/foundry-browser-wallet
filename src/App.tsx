import "./styles/App.css";

import { Provider } from "accounts";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Address, type Chain, createWalletClient, custom, type Hex } from "viem";
import { waitForTransactionReceipt } from "viem/actions";

import {
  api,
  applyChainId,
  isOk,
  renderJSON,
  renderMaybeParsedJSON,
  toBig,
  toNonce,
} from "./utils/helpers.ts";
import type {
  ApiErr,
  ApiOk,
  EIP1193,
  EIP6963AnnounceProviderEvent,
  EIP6963ProviderInfo,
  HistoryEntry,
  PendingAny,
  PendingSigning,
  SessionInfo,
  SignHistoryEntry,
  TxHistoryEntry,
} from "./utils/types.ts";

const POLL_REQUEST_INTERVAL_MS = 1000;
const POLL_SESSION_INTERVAL_MS = 3000;

export function App() {
  useEffect(() => {
    if (!window.__ACCOUNTS_PROVIDER__) {
      window.__ACCOUNTS_PROVIDER__ = Provider.create();
    }
  }, []);

  const [providers, setProviders] = useState<{ info: EIP6963ProviderInfo; provider: EIP1193 }[]>(
    [],
  );
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const selected = providers.find((p) => p.info.uuid === selectedUuid) ?? null;

  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [chain, setChain] = useState<Chain>();
  const [confirmed, setConfirmed] = useState<boolean>(false);

  const [pendingTx, setPendingTx] = useState<PendingAny | null>(null);
  const [pendingSigning, setPendingSigning] = useState<PendingSigning | null>(null);
  const [isSending, setIsSending] = useState<boolean>(false);

  // In-session history of every signed transaction and message. Flushed on
  // page reload (issue foundry-rs/foundry-browser-wallet#17).
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Tracks whether the BrowserSigner server is still alive. Becomes false
  // either when `/api/session` reports `alive: false` or when polling fails
  // (server gone). When false, polling is paused and the UI shows an
  // "end of session" badge while keeping the history visible.
  const [sessionAlive, setSessionAlive] = useState<boolean>(true);

  const prevSelectedUuidRef = useRef<string | null>(null);

  // --- helpers ---------------------------------------------------------------

  /// Insert or update a history entry by id. Newest entries are shown first
  /// in the UI.
  const upsertHistory = useCallback((entry: HistoryEntry) => {
    setHistory((prev) => {
      const idx = prev.findIndex((e) => e.id === entry.id);
      if (idx === -1) {
        return [entry, ...prev];
      }
      const next = prev.slice();
      next[idx] = entry;
      return next;
    });
  }, []);

  const updateHistory = useCallback(
    <K extends HistoryEntry["kind"]>(
      id: string,
      kind: K,
      patch: Partial<Extract<HistoryEntry, { kind: K }>>,
    ) => {
      setHistory((prev) =>
        prev.map((e) =>
          e.id === id && e.kind === kind ? ({ ...e, ...patch } as HistoryEntry) : e,
        ),
      );
    },
    [],
  );

  // --- wallet connection -----------------------------------------------------

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

  // Confirm the current connection. After this the polling loop runs and
  // the user no longer needs to reload between requests.
  const confirm = async () => {
    if (!account || chainId == null) return;

    try {
      await api("/api/connection", "POST", { address: account, chainId });
    } catch {
      return;
    }

    setConfirmed(true);
  };

  /// Disconnect the wallet. The Rust server will fail any in-flight request
  /// with a "Wallet disconnected" error so the script gets fast feedback
  /// instead of waiting for the per-request timeout.
  const disconnect = useCallback(async () => {
    try {
      await api("/api/connection", "POST", null);
    } catch {}

    setPendingTx(null);
    setPendingSigning(null);
    setAccount(undefined);
    setChainId(undefined);
    setChain(undefined);
    setConfirmed(false);
  }, []);

  // --- request handlers ------------------------------------------------------

  /// Sign and send the current pending transaction. Clears `pendingTx`
  /// immediately after the wallet returns a hash so the poller can pick up
  /// the next request without waiting for the receipt.
  const signAndSendCurrentTx = async () => {
    if (!selected || !pendingTx?.request || !sessionAlive || isSending) return;
    setIsSending(true);

    const id = pendingTx.id;
    const reqRecord = pendingTx.request as Record<string, unknown>;

    // Push a placeholder history entry immediately so the user sees the
    // request being processed even if signing takes a while.
    const placeholder: TxHistoryEntry = {
      kind: "tx",
      id,
      ts: Date.now(),
      request: reqRecord,
      status: "pending",
    };
    upsertHistory(placeholder);

    const walletClient = createWalletClient({
      transport: custom(selected.provider),
      chain,
    });

    let hash: Hex | undefined;

    try {
      const {
        from,
        input,
        to,
        maxFeePerGas,
        maxPriorityFeePerGas,
        gasPrice,
        gas,
        nonce,
        value,
        calls,
        ...txFields
      } = reqRecord;

      // The Tempo accounts SDK's eth_sendTransaction handler uses nullish
      // coalescing to fall back from calls[] to {to, data} — but an empty
      // array [] is truthy and bypasses the fallback. Omit calls when empty
      // so the SDK correctly converts to+data into a call entry.
      const resolvedCalls = Array.isArray(calls) && calls.length > 0 ? { calls } : {};

      // Convert hex-encoded numeric fields to BigInt/number for viem
      // compatibility. gasPrice (legacy) and EIP-1559 fee fields are
      // mutually exclusive.
      const feeFields =
        maxFeePerGas || maxPriorityFeePerGas
          ? {
              ...(maxFeePerGas ? { maxFeePerGas: toBig(maxFeePerGas as `0x${string}`) } : {}),
              ...(maxPriorityFeePerGas
                ? { maxPriorityFeePerGas: toBig(maxPriorityFeePerGas as `0x${string}`) }
                : {}),
            }
          : {
              ...(gasPrice ? { gasPrice: toBig(gasPrice as `0x${string}`) } : {}),
            };

      hash = await walletClient.sendTransaction({
        ...txFields,
        ...resolvedCalls,
        account: (from as Address) || (await walletClient.getAddresses())[0],
        ...(input ? { data: input as `0x${string}` } : {}),
        ...(to ? { to: to as Address } : {}),
        ...feeFields,
        ...(gas ? { gas: toBig(gas as `0x${string}`) } : {}),
        ...(nonce ? { nonce: toNonce(nonce as `0x${string}`) } : {}),
        ...(value ? { value: toBig(value as `0x${string}`) } : {}),
        chain,
      });
    } catch (e: unknown) {
      const msg = errMessage(e);
      console.error("send failed:", msg);

      if (!hash) {
        // Wallet rejected or failed before broadcasting — safe to report error.
        try {
          await api("/api/transaction/response", "POST", { id, hash: null, error: msg });
        } catch {}
        updateHistory(id, "tx", { status: "failed", error: msg });
      } else {
        // Tx was broadcast (hash known) but the response POST failed. Report
        // success so the script is not left waiting; the hash is preserved in
        // history.
        console.warn("response post failed after broadcast, reporting hash anyway:", hash);
        try {
          await api("/api/transaction/response", "POST", { id, hash, error: null });
        } catch {}
        updateHistory(id, "tx", { status: "sent", hash });
      }
      setPendingTx(null);
      setIsSending(false);
      return;
    }

    try {
      await api("/api/transaction/response", "POST", { id, hash, error: null });
    } catch (e: unknown) {
      // Tx is already live on-chain. Log and continue — history already shows
      // the hash.
      console.warn("response post failed after successful send:", errMessage(e));
    }

    // Mark as sent and clear the pending slot so the poller can re-arm
    // immediately for the next request.
    updateHistory(id, "tx", { status: "sent", hash });
    setPendingTx(null);
    setIsSending(false);

    // Fetch the receipt in the background; it'll update the entry when
    // ready. Failures here only affect the displayed receipt, never the
    // signing flow.
    void (async () => {
      try {
        const receipt = await waitForTransactionReceipt(walletClient, { hash: hash as Hex });
        updateHistory(id, "tx", { status: "mined", receipt });
      } catch (e) {
        const msg = errMessage(e);
        updateHistory(id, "tx", { status: "failed", error: msg });
      }
    })();
  };

  /// Sign the current pending message / typed data.
  const signCurrentMessage = async () => {
    if (!selected || !pendingSigning || !sessionAlive || isSending) return;
    setIsSending(true);

    const { id, signType, request } = pendingSigning;
    const signer = request.address;
    const msg = request.message;

    const placeholder: SignHistoryEntry = {
      kind: "sign",
      id,
      ts: Date.now(),
      signType,
      request,
      status: "pending",
    };
    upsertHistory(placeholder);

    try {
      let signature: Hex;
      switch (signType) {
        case "PersonalSign":
          signature = (await selected.provider.request({
            method: "personal_sign",
            params: [msg, signer],
          })) as Hex;
          break;
        case "SignTypedDataV4":
          signature = (await selected.provider.request({
            method: "eth_signTypedData_v4",
            params: [signer, msg],
          })) as Hex;
          break;
        default:
          throw new Error(`Unsupported signType: ${signType}`);
      }

      await api("/api/signing/response", "POST", { id, signature, error: null });

      updateHistory(id, "sign", { status: "signed", signature });
    } catch (e: unknown) {
      const msg = errMessage(e);

      try {
        await api("/api/signing/response", "POST", { id, signature: null, error: msg });
      } catch {}

      updateHistory(id, "sign", { status: "failed", error: msg });
    } finally {
      setPendingSigning(null);
      setIsSending(false);
    }
  };

  /// Reject the currently pending transaction or signing request without
  /// touching the wallet. Lets the user skip a request while keeping the
  /// session alive.
  const rejectCurrent = useCallback(async () => {
    if (pendingTx) {
      const id = pendingTx.id;
      const reason = "Rejected by user";
      try {
        await api("/api/transaction/response", "POST", { id, hash: null, error: reason });
      } catch {}
      upsertHistory({
        kind: "tx",
        id,
        ts: Date.now(),
        request: pendingTx.request as Record<string, unknown>,
        status: "failed",
        error: reason,
      });
      setPendingTx(null);
      return;
    }
    if (pendingSigning) {
      const { id, signType, request } = pendingSigning;
      const reason = "Rejected by user";
      try {
        await api("/api/signing/response", "POST", { id, signature: null, error: reason });
      } catch {}
      upsertHistory({
        kind: "sign",
        id,
        ts: Date.now(),
        signType,
        request,
        status: "failed",
        error: reason,
      });
      setPendingSigning(null);
    }
  }, [pendingTx, pendingSigning, upsertHistory]);

  // --- effects ---------------------------------------------------------------

  // Reset client state when switching wallets.
  useEffect(() => {
    if (
      prevSelectedUuidRef.current &&
      selectedUuid &&
      prevSelectedUuidRef.current !== selectedUuid
    ) {
      void disconnect();
    }
    prevSelectedUuidRef.current = selectedUuid;
  }, [selectedUuid, disconnect]);

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
      if (confirmed) {
        void disconnect();
        return;
      }
      setAccount((accounts[0] as Address) ?? undefined);
    };
    const onChainChanged = (raw: unknown) => {
      if (confirmed) {
        void disconnect();
        return;
      }
      applyChainId(raw, setChainId, setChain);
    };

    selected.provider.on?.("accountsChanged", onAccountsChanged);
    selected.provider.on?.("chainChanged", onChainChanged);
    return () => {
      selected.provider.removeListener?.("accountsChanged", onAccountsChanged);
      selected.provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [selected, confirmed, disconnect]);

  // Combined poller: while the session is alive, we are confirmed, and there
  // is no in-flight request, look for the next transaction or signing
  // request. Polling re-arms automatically as soon as
  // `pendingTx`/`pendingSigning` are cleared by the completion handlers.
  useEffect(() => {
    if (!confirmed || pendingTx || pendingSigning || !sessionAlive) return;

    let active = true;
    const id = window.setInterval(async () => {
      if (!active) return;

      try {
        const tx = await api<ApiOk<PendingAny> | ApiErr>("/api/transaction/request");
        if (isOk(tx)) {
          if (active) setPendingTx(tx.data);
          return;
        }
      } catch {}

      try {
        const sig = await api<ApiOk<PendingSigning> | ApiErr>("/api/signing/request");
        if (isOk(sig)) {
          if (active) setPendingSigning(sig.data);
        }
      } catch {}
    }, POLL_REQUEST_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [confirmed, pendingTx, pendingSigning, sessionAlive]);

  // Session liveness poller: detect when the BrowserSigner server is gone
  // (script finished, server stopped) so we can stop spamming the request
  // endpoints and surface a clean "session ended" UI.
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const resp = await api<ApiOk<SessionInfo> | ApiErr>("/api/session");
        if (!active) return;
        if (isOk(resp)) {
          setSessionAlive(resp.data.alive);
        } else {
          setSessionAlive(false);
        }
      } catch {
        if (active) setSessionAlive(false);
      }
    };
    void tick();
    const id = window.setInterval(tick, POLL_SESSION_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  // --- render ---------------------------------------------------------------

  return (
    <div className="wrapper">
      <div className="container">
        <div className="notice">
          Browser wallet is still in early development. Use with caution!
        </div>

        <img className="banner" src="banner.png" alt="Foundry Browser Wallet" />

        {!sessionAlive && (
          <div className="session-ended">
            Session ended. The script has finished or the server is no longer reachable.
          </div>
        )}

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

        {selected && account && confirmed && (
          <>
            <div className="section-title">Connected</div>
            <pre className="box">
              {`\
account: ${account}
chain:   ${chain ? `${chain.name} (${chainId})` : (chainId ?? "unknown")}
rpc:     ${chain?.rpcUrls?.default?.http?.[0] ?? chain?.rpcUrls?.public?.http?.[0] ?? "unknown"}`}
            </pre>
            <div className="disconnect-row">
              <button type="button" className="btn btn-secondary" onClick={() => void disconnect()}>
                Disconnect
              </button>
            </div>
          </>
        )}

        {selected && account && confirmed && sessionAlive && pendingTx && (
          <>
            <div className="section-title">Transaction to Sign &amp; Send</div>
            <div className="action-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={signAndSendCurrentTx}
                disabled={isSending || !sessionAlive}
              >
                Sign &amp; Send
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void rejectCurrent()}
                disabled={isSending || !sessionAlive}
              >
                Reject
              </button>
            </div>
            <div className="box">
              <pre>{renderJSON(pendingTx.request)}</pre>
            </div>
          </>
        )}

        {selected && account && confirmed && sessionAlive && !pendingTx && pendingSigning && (
          <>
            <div className="section-title">Message / Data to Sign</div>
            <div className="action-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={signCurrentMessage}
                disabled={isSending || !sessionAlive}
              >
                Sign
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void rejectCurrent()}
                disabled={isSending || !sessionAlive}
              >
                Reject
              </button>
            </div>
            <div className="box">
              <pre>{renderMaybeParsedJSON(pendingSigning.request)}</pre>
            </div>
          </>
        )}

        {selected &&
          account &&
          confirmed &&
          !pendingTx &&
          !pendingSigning &&
          history.length === 0 &&
          sessionAlive && (
            <>
              <div className="section-title">Waiting</div>
              <div className="box">
                <pre>No pending transaction or signing request</pre>
              </div>
            </>
          )}

        {history.length > 0 && (
          <>
            <div className="section-title">Session history</div>
            <div className="history">
              {history.map((entry) => (
                <HistoryCard key={entry.id} entry={entry} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// --- subcomponents ----------------------------------------------------------

function HistoryCard({ entry }: { entry: HistoryEntry }) {
  const [open, setOpen] = useState(false);

  if (entry.kind === "tx") {
    const summary =
      entry.status === "mined"
        ? `mined  ${entry.hash ?? ""}`
        : entry.status === "sent"
          ? `sent   ${entry.hash ?? ""}  (waiting for receipt)`
          : entry.status === "failed"
            ? `failed ${(entry.error ?? "").split("\n")[0]}`
            : "pending";
    return (
      <div className={`history-entry tx status-${entry.status}${open ? " open" : ""}`}>
        <button
          type="button"
          className="history-summary"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span className="history-kind">tx</span>
          <span className="history-status">{summary}</span>
          <Chevron />
        </button>
        {open && (
          <div className="history-details">
            <div className="section-subtitle">Request</div>
            <pre className="box">{renderJSON(entry.request)}</pre>
            {entry.hash && (
              <>
                <div className="section-subtitle">Hash</div>
                <pre className="box">{entry.hash}</pre>
              </>
            )}
            {entry.receipt && (
              <>
                <div className="section-subtitle">Receipt</div>
                <pre className="box">{renderJSON(entry.receipt)}</pre>
              </>
            )}
            {entry.status === "sent" && !entry.receipt && (
              <>
                <div className="section-subtitle">Receipt</div>
                <pre className="box">Waiting for receipt…</pre>
              </>
            )}
            {entry.error && (
              <>
                <div className="section-subtitle">Error</div>
                <pre className="box error">{entry.error}</pre>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  const summary =
    entry.status === "signed"
      ? `signed ${shortHash(entry.signature)}`
      : entry.status === "failed"
        ? `failed ${(entry.error ?? "").split("\n")[0]}`
        : "pending";
  return (
    <div className={`history-entry sign status-${entry.status}${open ? " open" : ""}`}>
      <button
        type="button"
        className="history-summary"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="history-kind">sig</span>
        <span className="history-status">{summary}</span>
        <Chevron />
      </button>
      {open && (
        <div className="history-details">
          <div className="section-subtitle">Type</div>
          <pre className="box">{entry.signType}</pre>
          <div className="section-subtitle">Request</div>
          <pre className="box">{renderMaybeParsedJSON(entry.request)}</pre>
          {entry.signature && (
            <>
              <div className="section-subtitle">Signature</div>
              <pre className="box">{entry.signature}</pre>
            </>
          )}
          {entry.error && (
            <>
              <div className="section-subtitle">Error</div>
              <pre className="box error">{entry.error}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/// Chevron icon used in history dropdown summaries. Inherits color from
/// its parent and is rotated 180° via CSS when the entry is open.
function Chevron() {
  return (
    <svg
      className="history-chevron"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// --- utilities --------------------------------------------------------------

function shortHash(h?: string): string {
  if (!h) return "";
  return h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-8)}` : h;
}

function errMessage(e: unknown): string {
  return typeof e === "object" &&
    e &&
    "message" in e &&
    typeof (e as { message?: unknown }).message === "string"
    ? (e as { message: string }).message
    : String(e);
}
