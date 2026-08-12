/**
 * The top line: what machine this is, and what the dashboard is doing.
 *
 * Facts are dropped from the right as the terminal narrows, in ascending order
 * of how often they change - the hostname is what tells you which ssh session
 * you are looking at, and it is the last thing to go.
 */

import { Box, Text } from 'ink';
import { memo } from 'react';
import os from 'node:os';
import { formatUptime } from 'cpumon/format';

import { useStyle } from '../hooks/useTheme.js';


export type HeaderProps = {
    width: number;
    version: string;
    intervalMs: number;
    paused: boolean;
};


export const Header = memo(function Header({ width, version, intervalMs, paused }: HeaderProps)
{
    const { theme } = useStyle();

    // os.uptime() is a syscall, but this renders once a tick at most and the
    // alternative is threading a static fact through the store for no reason
    const facts = [
        `cpumon-tui ${version}`,
        os.hostname(),
        `${os.type()} ${os.release()}`,
        `up ${formatUptime(os.uptime())}`,
        `${(intervalMs / 1000).toFixed(1)}s`,
    ];

    const right = paused ? '[PAUSED]' : '';
    const budget = width - (right.length === 0 ? 0 : right.length + 1);

    const shown: string[] = [];
    let used = 0;

    for (const fact of facts) {
        const cost = fact.length + (shown.length === 0 ? 0 : 3);

        if (used + cost > budget) {
            break;
        }

        shown.push(fact);
        used += cost;
    }

    return (
        <Box width={width} overflow="hidden">
            <Text color={theme.title} bold wrap="truncate-end">{shown[0] ?? ''}</Text>
            {shown.length > 1 ? (
                <Text color={theme.muted} wrap="truncate-end">{` · ${shown.slice(1).join(' · ')}`}</Text>
            ) : null}
            <Box flexGrow={1} />
            {right === '' ? null : <Text color={theme.warn} bold>{right}</Text>}
        </Box>
    );
});
