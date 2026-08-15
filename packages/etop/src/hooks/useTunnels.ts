/**
 * Reading the tunnel supervisor from a component.
 *
 * The same shape as useSlow and useStore, for the same reason: the instance is
 * created in runTui() and travels by context, never constructed in a component,
 * because React may call a useState initialiser and throw the result away -
 * which here would leave a supervisor holding ssh children that nothing will
 * ever stop.
 *
 * A missing provider is not an error. Every panel test that does not care about
 * tunnels renders without one, and a session with no config looks the same as
 * one that has not loaded yet: an empty list.
 */

import { createContext, useContext, useSyncExternalStore } from 'react';

import type { TunnelSupervisor, TunnelsState } from '../tunnels/supervisor.js';


const EMPTY: TunnelsState = { statuses: [], config: null, ticks: 0 };

const TunnelContext = createContext<TunnelSupervisor | null>(null);

export const TunnelProvider = TunnelContext.Provider;


export function useTunnels(): TunnelSupervisor | null
{
    return useContext(TunnelContext);
}


export function useTunnelsState(): TunnelsState
{
    const supervisor = useContext(TunnelContext);

    // a stable identity, so a component outside a provider does not re-render
    // forever for the same reason a fresh getSnapshot() would
    const subscribe = supervisor?.subscribe ?? noopSubscribe;
    const getSnapshot = supervisor?.getSnapshot ?? emptySnapshot;

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}


const noopSubscribe = (): (() => void) => () => {};

const emptySnapshot = (): TunnelsState => EMPTY;
