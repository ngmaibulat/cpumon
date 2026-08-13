/**
 * Reading the store from a component.
 *
 * The store instance travels by context and is created in runTui(), never in a
 * component. `useState(() => new SnapshotStore())` looks equivalent and is not:
 * React may call that initialiser and throw the result away, which here means
 * constructing a monitor - and therefore a timer, and a /proc scan - that
 * nothing will ever stop.
 */

import { createContext, useContext, useSyncExternalStore } from 'react';

import type { SnapshotStore, StoreState } from '../state/store.js';


const StoreContext = createContext<SnapshotStore | null>(null);

export const StoreProvider = StoreContext.Provider;


export function useStore(): SnapshotStore
{
    const store = useContext(StoreContext);

    if (store === null) {
        throw new Error('useStore() outside a StoreProvider');
    }

    return store;
}


export function useStoreState(): StoreState
{
    const store = useStore();

    // the third argument is getServerSnapshot. Passing the same getter keeps
    // React 19 quiet in any environment, and is correct here because there is
    // no server and no hydration to differ from.
    return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
