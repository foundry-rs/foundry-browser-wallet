import type { TransactionRequest } from "viem";

declare global {
  interface Window {
    __PORTO__?: unknown;
    __SESSION_TOKEN__?: string;
  }

  interface WindowEventMap {
    "eip6963:announceProvider": EIP6963AnnounceProviderEvent;
    "eip6963:requestProvider": Event;
  }
}

export type PendingSigning = {
  id: string;
  signType: "PersonalSign" | "SignTypedDataV4";
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
