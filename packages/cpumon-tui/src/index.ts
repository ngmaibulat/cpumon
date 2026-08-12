/**
 * The programmatic entry point.
 *
 * runTui() resolves with an exit code rather than calling process.exit itself,
 * so an embedder stays in control of its own process. The binary in cli.tsx is
 * the only thing here that exits.
 */

import { render } from 'ink';
import { createElement } from 'react';

import { App } from './app.js';
import { detectCapabilities } from './term/capabilities.js';
import { installLifecycle } from './term/lifecycle.js';
import type { TuiOptions } from '../types/index.js';

export type { GraphStyle, ThemeName, TuiOptions } from '../types/index.js';


export async function runTui(options: TuiOptions = {}): Promise<number>
{
    const capabilities = detectCapabilities(options);

    if (capabilities.refusal !== null) {
        console.error(`cpumon-tui: ${capabilities.refusal.message}`);
        console.error(`  ${capabilities.refusal.suggestion}`);

        return 1;
    }

    const instance = render(createElement(App, { capabilities }), {
        // ink enters and leaves the alternate screen itself, including on
        // unmount. hand-rolling it means racing ink's own final frame, which is
        // written after the restore sequence and smears the dashboard across
        // the user's shell
        alternateScreen: true,
        // quitting goes through exactly one path, ours, so that teardown order
        // is the same whether the user pressed q or Ctrl-C
        exitOnCtrlC: false,
        // a stray console.log from a dependency must not land in the middle of
        // a frame
        patchConsole: true,
        // only redraws the lines that changed. a dashboard changes three lines
        // in forty per tick, so this is the difference between smooth and
        // visibly flickering
        incrementalRendering: true,
    });

    const lifecycle = installLifecycle(instance, () => { /* nothing to stop yet */ });

    try {
        await instance.waitUntilExit();
    }
    finally {
        lifecycle.dispose();
    }

    return 0;
}
