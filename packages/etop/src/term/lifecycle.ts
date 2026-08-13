/**
 * Getting the terminal back.
 *
 * Ink owns the alternate screen (`alternateScreen: true`), so the only job left
 * is making sure unmount actually happens on every path out of the process -
 * and that nothing tries to print before it has.
 *
 * That second half is the subtle one. Ink documents alternate-screen teardown
 * output as disposable: anything written after unmount begins but before the
 * primary screen is restored is discarded. So a crash handler that prints the
 * stack and then unmounts produces a process that dies silently with no visible
 * error - the trace was written onto a screen the terminal was about to throw
 * away. Restore first, print second. Always.
 */

export type Teardown = {
    /** unmount Ink and wait for the primary screen to come back */
    restore: () => Promise<void>;
    /** stop listening; called once the process is on its way out anyway */
    dispose: () => void;
};


export type LifecycleTarget = {
    unmount: () => void;
    waitUntilExit: () => Promise<unknown>;
};


const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

/** the shell convention: a process killed by signal N exits with 128 + N */
const SIGNAL_NUMBER: Record<(typeof SIGNALS)[number], number> = {
    SIGINT: 2,
    SIGTERM: 15,
    SIGHUP: 1,
};


export function installLifecycle(
    instance: LifecycleTarget,
    onBeforeExit: () => void,
    proc: NodeJS.Process = process,
): Teardown
{
    let restoring: Promise<void> | null = null;

    const restore = (): Promise<void> => {
        // a SIGINT during an uncaught-exception teardown would otherwise start
        // a second unmount and race the first
        if (restoring !== null) {
            return restoring;
        }

        restoring = (async () => {
            onBeforeExit();
            instance.unmount();

            // waitUntilExit settles after the unmount writes have flushed, which
            // is the moment the primary screen is actually back
            await instance.waitUntilExit().catch(() => undefined);
        })();

        return restoring;
    };

    const onSignal = (signal: (typeof SIGNALS)[number]) => () => {
        void restore().then(() => proc.exit(128 + SIGNAL_NUMBER[signal]));
    };

    const handlers = SIGNALS.map(signal => {
        const handler = onSignal(signal);
        proc.once(signal, handler);

        return { signal, handler } as const;
    });

    const onCrash = (err: unknown) => {
        void restore().then(() => {
            // now that the primary screen is back, this is somewhere the user
            // can actually read
            console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
            proc.exit(1);
        });
    };

    proc.once('uncaughtException', onCrash);
    proc.once('unhandledRejection', onCrash);

    return {
        restore,
        dispose: () => {
            for (const { signal, handler } of handlers) {
                proc.off(signal, handler);
            }

            proc.off('uncaughtException', onCrash);
            proc.off('unhandledRejection', onCrash);
        },
    };
}
