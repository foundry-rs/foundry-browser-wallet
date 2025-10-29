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

export const pick = <T>(...vals: (T | undefined)[]): T | undefined =>
  vals.find((v) => v !== undefined);

export const readAddr = (obj: any, ...keys: string[]): `0x${string}` | undefined => {
  for (const key of keys) {
    const val = obj?.[key];
    if (typeof val === "string" && val.startsWith("0x") && val.length === 42)
      return val as `0x${string}`;
    if (val && typeof val === "object" && "Call" in val && typeof val.Call === "string")
      return val.Call as `0x${string}`;
  }
  return undefined;
};

export const readHex = (obj: any, ...keys: string[]): `0x${string}` | undefined => {
  for (const key of keys) {
    const v = obj?.[key];
    if (typeof v === "string" && v.startsWith("0x")) return v as `0x${string}`;
    if (typeof v === "number" || typeof v === "bigint")
      return `0x${BigInt(v).toString(16)}` as `0x${string}`;
  }
  return undefined;
};

export const renderJSON = (obj: unknown) =>
  JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);

export const isOk = <T>(r: ApiOk<T> | ApiErr | null | undefined): r is ApiOk<T> => {
  return !!r && (r as ApiOk<T>).status === "ok";
};
