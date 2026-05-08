import type { Hex, TransactionReceipt, TransactionRequest } from "viem";

declare global {
  interface Window {
    __ACCOUNTS_PROVIDER__?: unknown;
    __SESSION_TOKEN__?: string;
  }

  interface WindowEventMap {
    "eip6963:announceProvider": EIP6963AnnounceProviderEvent;
    "eip6963:requestProvider": Event;
  }
}

export type SignType = "PersonalSign" | "SignTypedDataV4";

export type PendingSigning = {
  id: string;
  signType: SignType;
  request: {
    message: string;
    address: string;
  };
};

export type EIP6963ProviderInfo = {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
};

export type EIP1193Events = {
  connect: (info: { chainId: string }) => void;
  disconnect: (error: { code: number; message: string }) => void;
  message: (message: { type: string; data: unknown }) => void;
  chainChanged: (chainId: string) => void;
  accountsChanged: (accounts: readonly string[]) => void;
};

export interface EIP1193 {
  request<T = unknown>(args: {
    method: string;
    params?: readonly unknown[] | Record<string, unknown>;
  }): Promise<T>;
  on?<K extends keyof EIP1193Events>(event: K, listener: EIP1193Events[K]): void;
  removeListener?<K extends keyof EIP1193Events>(event: K, listener: EIP1193Events[K]): void;
}

export type EIP6963ProviderDetail = {
  info: EIP6963ProviderInfo;
  provider: EIP1193;
};

export interface EIP6963AnnounceProviderEvent extends CustomEvent<EIP6963ProviderDetail> {
  type: "eip6963:announceProvider";
}

export type ApiOk<T> = { status: "ok"; data: T };

export type ApiErr = { status: string; message?: string };

export type PendingAny = Record<string, unknown> & { id: string; request: TransactionRequest };

/// Mirrors the `SessionInfo` type returned by `GET /api/session` from the
/// Rust BrowserWalletServer.
export type SessionInfo = {
  alive: boolean;
  connected: boolean;
};

/// Status of a transaction in the in-session history.
/// - `pending`:  user is being prompted to sign
/// - `sent`:     the wallet returned a hash, waiting for the receipt
/// - `mined`:    the receipt has been retrieved
/// - `failed`:   the wallet rejected, the send failed, or the receipt fetch failed
export type TxStatus = "pending" | "sent" | "mined" | "failed";

/// Status of a signing request in the in-session history.
/// - `pending`: user is being prompted to sign
/// - `signed`:  signature returned successfully
/// - `failed`:  the wallet rejected or signing failed
export type SignStatus = "pending" | "signed" | "failed";

export type TxHistoryEntry = {
  kind: "tx";
  id: string;
  ts: number;
  request: Record<string, unknown>;
  status: TxStatus;
  hash?: Hex;
  receipt?: TransactionReceipt;
  error?: string;
};

export type SignHistoryEntry = {
  kind: "sign";
  id: string;
  ts: number;
  signType: SignType;
  request: { message: string; address: string };
  status: SignStatus;
  signature?: Hex;
  error?: string;
};

export type HistoryEntry = TxHistoryEntry | SignHistoryEntry;
