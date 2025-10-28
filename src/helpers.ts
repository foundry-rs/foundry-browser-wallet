import * as chains from "viem/chains";
import type { Chain } from "viem";

const ALL_CHAINS: readonly Chain[] = Object.freeze(
  Object.values(chains) as Chain[]
);

const getChainById = (id: number) => ALL_CHAINS.find((c) => c.id === id);

const parseChainId = (input: unknown): number | undefined => {
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : undefined;
  }

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
  setChain: (c: Chain | undefined) => void
) => {
  const id = parseChainId(raw);
  setChainId(id);
  setChain(id != null ? getChainById(id) : undefined);
};
