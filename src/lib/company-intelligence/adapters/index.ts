/**
 * Adapter registry.
 *
 * The one place the pipeline learns which sources exist. A new metadata source
 * — a curated open dataset, a company-registry API, a future standalone
 * collector — is added by writing an adapter that implements SourceAdapter and
 * registering it here. Nothing else in the pipeline changes.
 *
 * The separation of responsibilities the project intends: this codebase owns
 * the adapter *interface*, the normalizer, the validator and the importer; a
 * separate collector (in any language) produces canonical JSON/CSV that the
 * built-in seed_file adapter ingests. A collector never needs to know anything
 * about this schema — it targets the documented seed format.
 */

import type { SourceAdapter } from "../types";
import { seedFileAdapter } from "./seed-file";

const REGISTRY = new Map<string, SourceAdapter>();

export function registerAdapter(adapter: SourceAdapter): void {
  if (REGISTRY.has(adapter.key)) {
    throw new Error(`Adapter "${adapter.key}" is already registered.`);
  }
  REGISTRY.set(adapter.key, adapter);
}

export function getAdapter(key: string): SourceAdapter | undefined {
  return REGISTRY.get(key);
}

export function listAdapters(): SourceAdapter[] {
  return [...REGISTRY.values()];
}

// Built-in adapters.
registerAdapter(seedFileAdapter);

export { seedFileAdapter };
