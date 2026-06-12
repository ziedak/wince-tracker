// ===========================================================================
// @wince/storage/cookie — sub-path entry
//
// Exposes only the raw CookieStore class and its options type.
// Importing from this path avoids pulling in MultiStorage, DurableQueue,
// or the pre-built singleton instances from the main barrel.
// ===========================================================================

export type { CookieStoreOptions } from './stores/CookieStore';
export { CookieStore, getRootDomain, resetRootDomainCache } from './stores/CookieStore';
