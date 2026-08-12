/**
 * The test surface.
 *
 * Deliberately not in package.json's `exports`, so it is not public API - but
 * it is a real entry point, because the alternative is worse. The build bundles
 * with code splitting, so a test that reached into a module directly would be
 * importing `dist/chunk-YVT2GH6V.js`, a name that changes whenever the contents
 * do.
 *
 * Everything reachable from here is a pure function. Components and hooks are
 * exercised through ink's renderToString instead, which needs no help from this
 * file.
 */

export {
    checkRefusal,
    detectCapabilities,
    detectColorLevel,
    resolveGraphStyle,
    supportsUnicode,
} from './term/capabilities.js';

export type { Capabilities, Refusal } from './term/capabilities.js';

export { installLifecycle } from './term/lifecycle.js';

export { buildHelp, parseCliArgs } from './cli-args.js';

export { Ring } from './render/ring.js';

export { SnapshotStore } from './state/store.js';
export type { MonitorLike, MonitorOptions, StoreOptions, StoreState } from './state/store.js';
