/**
 * What a panel shows when its probe failed.
 *
 * The rule that matters is what is NOT here: this never draws a zeroed graph.
 * A flat line at the bottom is a claim about the machine - that it moved no
 * packets, ran no processes - and a diagnostic tool making a false claim is
 * worse than one admitting it does not know. An empty panel with a reason is
 * the truth and is one search away from a fix.
 *
 * Which reasons reach this component at all is decided by the layout, not here.
 * 'not-applicable' and 'unsupported-platform' mean the panel should not exist
 * on this machine, so useLayout drops it entirely and the remaining panels
 * reflow. What arrives here is the actionable set: a permission denied, a
 * missing file, a parse failure - things a user can do something about.
 */

import { Box, Text } from 'ink';

import { useTheme } from '../hooks/useTheme.js';
import type { UnavailableReason } from 'libsysmon';


export type UnavailableProps = {
    reason: UnavailableReason;
    detail?: string;
    width: number;
    height: number;
};


/** what each reason actually means to someone looking at a dashboard */
const EXPLANATION: Record<UnavailableReason, string> = {
    'permission-denied': 'not readable by this user',
    'not-found': 'the kernel interface is missing',
    'parse-error': 'the kernel interface was unreadable',
    'unsupported-platform': 'needs /proc, which this platform has not got',
    'not-applicable': 'not a concept on this platform',
};


export function Unavailable({ reason, detail, width, height }: UnavailableProps)
{
    const theme = useTheme();

    return (
        <Box width={width} height={height} flexDirection="column" overflow="hidden">
            <Text color={theme.muted} wrap="truncate-end">{`unavailable — ${EXPLANATION[reason]}`}</Text>
            {detail === undefined ? null : (
                <Text color={theme.muted} dimColor wrap="truncate-end">{detail}</Text>
            )}
        </Box>
    );
}
