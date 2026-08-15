/**
 * Reading the slow poller from a component.
 *
 * Exactly the shape of useStore, and for the same reasons: the instance is
 * created in runTui() and travels by context, never constructed in a component,
 * because React may call a useState initialiser and throw the result away -
 * which here would leave a timer and an open socket nothing will ever stop.
 *
 * The one difference is that a missing provider is not an error. Every panel
 * test that does not care about docker renders without one, and a slow source
 * that has never been asked for looks the same as one that has not answered
 * yet: `undefined`, which is what <Loading> already reads.
 */

import { createContext, useContext, useSyncExternalStore } from 'react';

import type { SlowPoller, SlowState } from '../state/slow.js';


const EMPTY: SlowState = { ticks: 0 };

const SlowContext = createContext<SlowPoller | null>(null);

export const SlowProvider = SlowContext.Provider;


export function useSlow(): SlowPoller | null
{
    return useContext(SlowContext);
}


export function useSlowState(): SlowState
{
    const poller = useContext(SlowContext);

    // a stable identity, so a component outside a provider does not re-render
    // forever for the same reason a fresh getSnapshot() would
    const subscribe = poller?.subscribe ?? noopSubscribe;
    const getSnapshot = poller?.getSnapshot ?? emptySnapshot;

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}


const noopSubscribe = (): (() => void) => () => {};

const emptySnapshot = (): SlowState => EMPTY;
