/**
 * Confirming a signal.
 *
 * This is the one irreversible action in an otherwise read-only tool, so the
 * UX is built around making an accident nearly impossible rather than around
 * being quick:
 *
 * - It is reached by `K`, not `k`. `k` is vim-up in the table right behind it.
 * - Confirming is `y`, not Enter. Enter is muscle memory in a list, and the
 *   list is what you were just using.
 * - The process is named on screen - pid and command - so what is about to be
 *   signalled is read, not remembered.
 * - The list underneath is frozen while this is open. Without that the row
 *   could shift between reading the pid and confirming it, and the confirmation
 *   would be for a process the user never looked at. That is the failure this
 *   whole component exists to prevent.
 * - The default is SIGTERM, and SIGKILL sits at the bottom of the list under
 *   two recoverable options.
 */

import { Box, Text } from 'ink';
import { memo } from 'react';

import { SIGNALS } from '../state/signals.js';
import { useStyle } from '../hooks/useTheme.js';
import type { SignalName } from '../state/signals.js';
import type { KillTarget } from '../state/types.js';


export type KillModalProps = {
    width: number;
    height: number;
    target: KillTarget | null;
    signal: SignalName;
    /** false when the dashboard was started without --allow-kill */
    allowed: boolean;
};


export const KillModal = memo(function KillModal({ width, height, target, signal, allowed }: KillModalProps)
{
    const { theme, unicode } = useStyle();

    const inner = Math.max(0, width - 2);

    return (
        <Box
            width={width}
            height={height}
            flexDirection="column"
            overflow="hidden"
            borderStyle={unicode ? 'round' : 'classic'}
            borderColor={theme.danger}
        >
            {!allowed
                ? <Disabled width={inner} />
                : target === null
                    ? <Text color={theme.muted} wrap="truncate-end">no process selected</Text>
                    : <Confirm width={inner} target={target} signal={signal} />}
        </Box>
    );
});


function Disabled({ width }: { width: number })
{
    const { theme } = useStyle();

    return (
        <Box width={width} flexDirection="column" overflow="hidden">
            <Text color={theme.warn} bold wrap="truncate-end">Signalling is disabled</Text>
            <Text> </Text>
            <Text color={theme.label} wrap="truncate-end">
                Restart with --allow-kill to send signals from this table.
            </Text>
            <Text> </Text>
            <Text color={theme.muted} wrap="truncate-end">Esc to close</Text>
        </Box>
    );
}


function Confirm({ width, target, signal }: { width: number; target: KillTarget; signal: SignalName })
{
    const { theme } = useStyle();

    const chosen = SIGNALS.find(item => item.name === signal) ?? SIGNALS[0];

    return (
        <Box width={width} flexDirection="column" overflow="hidden">
            <Text color={theme.danger} bold wrap="truncate-end">
                {`Signal ${target.comm}?`}
            </Text>
            <Text color={theme.label} wrap="truncate-end">
                {`pid ${target.pid} · ${target.threads} thread${target.threads === 1 ? '' : 's'}`}
            </Text>
            <Text> </Text>
            {SIGNALS.map(item => {
                const selected = item.name === signal;

                return (
                    <Text
                        key={item.name}
                        wrap="truncate-end"
                        color={selected ? theme.value : theme.muted}
                        bold={selected}
                    >
                        {`${selected ? '▸ ' : '  '}${item.name.padEnd(8)} ${item.description}`}
                    </Text>
                );
            })}
            <Text> </Text>
            <Text wrap="truncate-end">
                <Text color={theme.label}>{'↑ ↓ choose · '}</Text>
                <Text color={theme.danger} bold>{'y'}</Text>
                <Text color={theme.label}>{` send ${chosen.name}`}</Text>
                <Text color={theme.label}>{' · Esc cancel'}</Text>
            </Text>
            {chosen.forceful ? (
                <Text color={theme.warn} wrap="truncate-end">
                    {chosen.name === 'SIGKILL'
                        ? 'SIGKILL cannot be caught: no cleanup, no saving, no unwinding'
                        : 'SIGSTOP cannot be caught: the process freezes until SIGCONT'}
                </Text>
            ) : null}
        </Box>
    );
}
