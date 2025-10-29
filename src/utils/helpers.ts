import type { Chain } from "viem";
import * as chains from "viem/chains";
import type { EIP1193 } from "./types";

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

export const readPendingChainId = (p: Record<string, unknown>): number | undefined =>
  parseChainId(p.chainId) ?? parseChainId((p as any).chain_id) ?? parseChainId((p as any).network);

export const toHexChainId = (id: number): `0x${string}` => `0x${id.toString(16)}` as `0x${string}`;

export const ensureChainSelected = async (
  provider: EIP1193,
  wantChainId?: number,
  haveChainId?: number,
): Promise<void> => {
  if (!wantChainId || wantChainId === haveChainId) return;
  const chainIdHex = toHexChainId(wantChainId);
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
    return;
  } catch (err: any) {
    const code = err?.code ?? err?.data?.originalError?.code;
    if (code !== 4902) throw err;

    const meta = getChainById(wantChainId);
    if (!meta) throw new Error(`Unknown chainId ${wantChainId}`);

    const rpc = meta.rpcUrls?.default?.http?.length
      ? meta.rpcUrls.default.http
      : (meta.rpcUrls?.public?.http ?? []);

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex,
          chainName: meta.name,
          rpcUrls: rpc,
          nativeCurrency: (meta.nativeCurrency as {
            name: string;
            symbol: string;
            decimals: number;
          }) ?? { name: "Ether", symbol: "ETH", decimals: 18 },
        },
      ],
    });

    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  }
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
