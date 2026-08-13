/**
 * Hand-written SystemSnapshot literals.
 *
 * Panels are asserted against these rather than against live /proc, so a test
 * failure means the panel changed and never means the machine did. The shapes
 * are copied from libsysmon's exported types; anything a panel reads must be here.
 */

export const memory = (over = {}) => ({
    source: 'meminfo',
    total: 16 * 1024 ** 3,
    free: 2 * 1024 ** 3,
    available: 6 * 1024 ** 3,
    buffers: 1 * 1024 ** 3,
    cached: 3 * 1024 ** 3,
    used: 10 * 1024 ** 3,
    usedRatio: 0.625,
    usedPercentage: 62,
    swapTotal: 4 * 1024 ** 3,
    swapFree: 3 * 1024 ** 3,
    swapUsed: 1 * 1024 ** 3,
    ...over,
});


export const core = (percentage, model = 'Test CPU @ 3.0GHz') => ({
    model,
    idle: 1000,
    load: percentage * 10,
    total: 1000 + percentage * 10,
    loadRatio: percentage / 100,
    loadPercentage: percentage,
});


export const disk = (over = {}) => ({
    available: true,
    disk: {
        mount: '/',
        size: 500 * 1024 ** 3,
        free: 120 * 1024 ** 3,
        available: 100 * 1024 ** 3,
        used: 380 * 1024 ** 3,
        usedRatio: 0.79,
        usedPercentage: 79,
        ...over,
    },
});


export const snapshot = (over = {}) => {
    const cores = over.cores ?? [20, 80];

    return {
        timestamp: 1_700_000_000_000,
        elapsedMs: 1000,
        cpu: cores.map(value => core(value)),
        cpuOverall: core(Math.round(cores.reduce((a, b) => a + b, 0) / cores.length)),
        memory: memory(),
        load: { available: true, one: 1.2, five: 0.98, fifteen: 0.71, cores: cores.length, onePerCore: 0.6, fivePerCore: 0.49, fifteenPerCore: 0.36 },
        disk: disk(),
        network: { available: true, elapsedMs: 1000, interfaces: [] },
        processes: { available: true, processes: [] },
        containers: { available: true, scope: 'host', containers: [] },
        ...over,
    };
};


/**
 * A store stand-in.
 *
 * Panels read history off the store and their current values off the snapshot,
 * so a fake needs both. Rings are real - they are pure and cheap, and faking
 * them would mean the graph assertions tested the fake.
 */
export function fakeStore(Ring, { snapshot: snap = snapshot(), history = [], cores = [], ticks } = {})
{
    const ring = values => {
        const r = new Ring(512);

        for (const value of values) {
            r.push(value);
        }

        return r;
    };

    // built once and handed back by reference. useSyncExternalStore compares
    // the result of getSnapshot by identity, so a fixture that rebuilt this
    // object per call would re-render forever - which presents as "Maximum
    // update depth exceeded" from somewhere entirely unrelated.
    const state = {
        snapshot: snap,
        error: null,
        ticks: ticks ?? (snap === null ? 0 : 1),
        intervalMs: 1000,
        paused: false,
    };

    return {
        rings: {
            cpu: ring(history),
            memory: ring(history),
            swap: ring(history),
            rx: ring(history),
            tx: ring(history),
            load: ring(history),
        },
        cores: cores.map(values => ring(values)),
        interfaces: new Map(),
        seriesFor: () => ({ rx: ring(history), tx: ring(history) }),
        spawns: 1,
        getSnapshot: () => state,
        subscribe: () => () => {},
        options: {},
        setPaused() {},
        setIntervalMs() {},
        setTop() {},
        setSort() {},
        reset() {},
        dispose() {},
    };
}
