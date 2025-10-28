export type EIP6963ProviderInfo = {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
};

export type EIP1193 = {
  request: (args: { method: string; params?: any[] | object }) => Promise<any>;
  on?: (event: string, listener: (...args: any[]) => void) => void;
  removeListener?: (event: string, listener: (...args: any[]) => void) => void;
};

export type AnnounceEvent = CustomEvent<{
  info: EIP6963ProviderInfo;
  provider: EIP1193;
}>;
