import { digitaloceanProvider } from "./digitalocean";
import { hetznerProvider } from "./hetzner";
import type { CloudProvider, ProviderDeps, ProviderId } from "./types";

export type Sleep = (ms: number) => Promise<void>;

/** Normalizes the adapters' slightly different constructor shapes. */
export function makeProvider(id: ProviderId, deps: ProviderDeps, sleep?: Sleep): CloudProvider {
  switch (id) {
    case "hetzner":
      return sleep ? hetznerProvider(deps, sleep) : hetznerProvider(deps);
    case "digitalocean":
      return digitaloceanProvider(sleep ? { ...deps, sleep } : deps);
  }
}
