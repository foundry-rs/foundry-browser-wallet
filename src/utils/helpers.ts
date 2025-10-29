import { type Chain, hexToBigInt } from "viem";
import * as chains from "viem/chains";

export const ALL_CHAINS: readonly Chain[] = Object.freeze(Object.values(chains) as Chain[]);
export const getChainById = (id: number) => ALL_CHAINS.find((c) => c.id === id);

const parseChainId = (input: unknown): number | undefined => {
  if (typeof input === "number") return Number.isFinite(input) ? input : undefined;
  if (typeof input !== "string") return undefined;
  const s = input.trim();
  if (/^0x[0-9a-fA-F]+$/.test(s)) {
    const n = Number.parseInt(s, 16);
    return Number.isNaN(n) ? undefined : n;
  }
  if (/^\d+$/.test(s)) {
    const n = Number.parseInt(s, 10);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
};

export const applyChainId = (
  raw: unknown,
  setChainId: (n: number | undefined) => void,
  setChain: (c: Chain | undefined) => void,
) => {
  const id = parseChainId(raw);
  setChainId(id);
  setChain(id != null ? getChainById(id) : undefined);
};

export const toBig = (h?: `0x${string}`) => (h ? hexToBigInt(h) : undefined);

import type { ApiErr, ApiOk } from "./types";

export const ENDPOINT = "http://127.0.0.1:9545";

export const api = async <T = unknown>(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): Promise<T> => {
  const res = await fetch(`${ENDPOINT}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API request failed: ${res.status} ${res.statusText}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error("Invalid JSON response");
  }
};

export const renderJSON = (obj: unknown) =>
  JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);

export const isOk = <T>(r: ApiOk<T> | ApiErr | null | undefined): r is ApiOk<T> => {
  return !!r && (r as ApiOk<T>).status === "ok";
};
