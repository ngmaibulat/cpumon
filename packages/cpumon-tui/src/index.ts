/**
 * The programmatic entry point.
 *
 * runTui() resolves with an exit code rather than calling process.exit itself,
 * so an embedder stays in control of its own process. cli.tsx is the only thing
 * here that exits.
 */

import { render } from 'ink';
import { createElement } from 'react';

import { App } from './app.js';
import { getVersion } from './cli-args.js';
import { StoreProvider } from './hooks/useStore.js';
import { SnapshotStore } from './state/store.js';
import { detectCapabilities } from './term/capabilities.js';
import { installLifecycle } from './term/lifecycle.js';
import type { TuiOptions } from '../types/index.js';

export type { GraphStyle, ThemeName, TuiOptions } from '../types/index.js';


/**
 * Everything, every tick. The dashboard shows all of it at once, so there is no
 * per-panel collector set to narrow this down to - and a probe that comes back
 * unavailable costs one failed open(), not a scan.
 */
const COLLECTORS = ['cpu', 'memory', 'load', 'disk', 'network', 'process', 'container'] as const;

/**
 * Process rows to collect before anything has measured the terminal.
 *
 * Generous on purpose: the panel narrows it once it knows its own height, and
 * starting too low means the first frame is visibly short and then grows.
 */
const INITIAL_TOP = 64;


export async function runTui(options: TuiOptions = {}): Promise<number>
{
    const capabilities = detectCapabilities(options);

    if (capabilities.refusal !== null) {
        console.error(`cpumon-tui: ${capabilities.refusal.message}`);
        console.error(`  ${capabilities.refusal.suggestion}`);

        return 1;
    }

    // constructed before render(), so the very first frame already has a store
    // to read and no 'sample' can land before anything is listening
    const store = new SnapshotStore({
        intervalMs: options.intervalMs ?? 1000,
        collect: [...COLLECTORS],
        mount: options.mount,
        top: options.top ?? INITIAL_TOP,
        sort: 'cpu',
        sortReverse: false,
    });

    const instance = render(
        createElement(StoreProvider, { value: store },
            createElement(App, {
                capabilities,
                version: getVersion(),
                allowKill: options.allowKill === true,
                theme: options.theme ?? 'auto',
                graph: options.graph ?? 'auto',
                intervalMs: options.intervalMs ?? 1000,
            })),
        {
            // ink enters and leaves the alternate screen itself, including on
            // unmount. Hand-rolling it means racing ink's own final frame,
            // which is written after the restore sequence and smears the
            // dashboard across the user's shell.
            alternateScreen: true,
            // quitting goes through exactly one path, ours, so teardown order
            // is identical whether the user pressed q or Ctrl-C
            exitOnCtrlC: false,
            // a stray console.log from a dependency must not land mid-frame
            patchConsole: true,
            // redraws only the lines that changed. A dashboard changes three
            // lines in forty per tick, so this is the difference between smooth
            // and visibly flickering.
            incrementalRendering: true,
        });

    const lifecycle = installLifecycle(instance, () => store.dispose());

    try {
        await instance.waitUntilExit();
    }
    finally {
        // the normal quit path: the signal handlers never fired, so nothing has
        // stopped the monitor yet
        store.dispose();
        lifecycle.dispose();
    }

    return 0;
}
