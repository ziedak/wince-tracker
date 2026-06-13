// ===========================================================================
// @wince/storage/memory — sub-path entry
//
// Exposes only the raw MemoryStore class and its options type.
// Importing from this path avoids pulling in MultiStorage, DurableQueue,
// or the pre-built singleton instances from the main barrel.
// ===========================================================================

import { createMultiStore } from "./stores/MultiStorage";

export const MemoryStore = createMultiStore({ strategies: ['memory'] });