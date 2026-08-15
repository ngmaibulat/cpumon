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
import { SlowProvider } from './hooks/useSlow.js';
import { StoreProvider } from './hooks/useStore.js';
import { TunnelProvider } from './hooks/useTunnels.js';
import { SlowPoller } from './state/slow.js';
import { SnapshotStore } from './state/store.js';
import { detectCapabilities } from './term/capabilities.js';
import { resolveEditor, runEditor } from './term/editor.js';
import { installLifecycle } from './term/lifecycle.js';
import { configPath } from './tunnels/config.js';
import { loadTunnelConfig, writeTemplate } from './tunnels/load.js';
import { TunnelSupervisor } from './tunnels/supervisor.js';
import type { Teardown } from './term/lifecycle.js';
import type { TuiOptions } from '../types/index.js';

export type { GraphStyle, ThemeName, TuiOptions } from '../types/index.js';


/**
 * Everything, every tick. The dashboard shows all of it at once, so there is no
 * per-panel collector set to narrow this down to - and a probe that comes back
 * unavailable costs one failed open(), not a scan.
 */
const COLLECTORS = ['cpu', 'memory', 'load', 'disk', 'network', 'process', 'container', 'connection'] as const;

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
        console.error(`etop: ${capabilities.refusal.message}`);
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

    // constructed here for the same reasons the store is, and idle until a
    // screen asks it for something: nothing polls a socket on the dashboard
    const slow = new SlowPoller({});

    // Unlike the poller, this is NOT gated by the visible screen: a tunnel has
    // to stay up while you are looking at the CPU graph. It is still idle
    // until something asks - a config with no autostart entry spawns nothing.
    const tunnels = new TunnelSupervisor({});
    const path = configPath();

    tunnels.setConfig(loadTunnelConfig(path));
    tunnels.startAutostart();

    // assigned after render() below; the closure reads it when the key is
    // pressed, by which time it exists
    let lifecycle: Teardown | null = null;

    /**
     * The process half of the `e` key.
     *
     * App owns the ink half - suspending and restoring the terminal - because
     * only a component can reach useApp. This half is here because only runTui
     * holds the lifecycle whose signal handlers have to stand down, and the
     * supervisor that has to be told what the file now says.
     */
    const editConfig = async (): Promise<{ ok: boolean; message: string }> => {
        const editor = resolveEditor();

        if (editor === null) {
            return { ok: false, message: 'no editor found; set $VISUAL or $EDITOR' };
        }

        // a first-time user pressing `e` should get a file with something in
        // it, not an empty buffer. Never overwrites; see writeTemplate.
        writeTemplate(path);

        const resume = lifecycle?.suspend() ?? (() => {});

        try {
            const result = await runEditor(path, editor);

            if (!result.ok) {
                return result;
            }
        }
        finally {
            resume();
        }

        // reload now rather than leaving a broken file to be discovered later,
        // when the context has gone. A failed parse changes nothing that is
        // running - see setConfig.
        return tunnels.setConfig(loadTunnelConfig(path));
    };

    const instance = render(
        createElement(TunnelProvider, { value: tunnels },
            createElement(SlowProvider, { value: slow },
                createElement(StoreProvider, { value: store },
                    createElement(App, {
                        capabilities,
                        version: getVersion(),
                        allowKill: options.allowKill === true,
                        theme: options.theme ?? 'auto',
                        graph: options.graph ?? 'auto',
                        intervalMs: options.intervalMs ?? 1000,
                        editConfig,
                    })))),
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

    lifecycle = installLifecycle(instance, () => {
        store.dispose();
        slow.dispose();
        // what makes "the tunnels die with etop" true rather than merely usual:
        // a SIGTERM from outside the terminal never reaches the children, and
        // without this they would be orphaned holding their ports
        tunnels.dispose();
    });

    try {
        await instance.waitUntilExit();
    }
    finally {
        // the normal quit path: the signal handlers never fired, so nothing has
        // stopped the monitor yet
        store.dispose();
        slow.dispose();
        tunnels.dispose();
        lifecycle.dispose();
    }

    return 0;
}
