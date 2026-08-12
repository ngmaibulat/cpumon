/**
 * A one-line meter: a label, a bar, and a figure.
 *
 * The bar's last filled cell is fractional, which matters more than it sounds.
 * At the widths a panel actually has, a whole-cell bar quantises to steps of
 * eight or ten per cent, and a gauge that only moves in tenths reads as stuck
 * rather than as coarse.
 */

import { Box, Text } from 'ink';
import { memo } from 'react';

import { meterAscii } from '../render/ascii.js';
import { meter } from '../render/blocks.js';
import { rampStep } from '../theme/ramp.js';
import { useStyle } from '../hooks/useTheme.js';
import type { Ramp } from '../theme/index.js';


export type GaugeProps = {
    label: string;
    /** 0..1 */
    ratio: number;
    /** total width, including the label and the figure */
    width: number;
    ramp: Ramp;
    /** shown right of the bar; the percentage, unless something is more useful */
    value?: string;
    /** width reserved for the label, so a column of gauges lines up */
    labelWidth?: number;
};


export const Gauge = memo(function Gauge({ label, ratio, width, ramp, value, labelWidth }: GaugeProps)
{
    const { theme, unicode } = useStyle();

    const shown = value ?? `${Math.round(clamp01(ratio) * 100)}%`;
    const labelCells = labelWidth ?? label.length;

    // brackets make the bar's extent unambiguous when it is nearly empty, which
    // is otherwise indistinguishable from a bar that failed to draw
    const chrome = labelCells + 1 + 2 + 1 + shown.length;
    const barWidth = Math.max(0, width - chrome);

    if (barWidth < 1) {
        // no room for a bar; the number is the part worth keeping
        return (
            <Box width={width} overflow="hidden">
                <Text color={theme.label} wrap="truncate-end">{`${label.padEnd(labelCells)} `}</Text>
                <Text color={rampStep(ramp, ratio)} wrap="truncate-end">{shown}</Text>
            </Box>
        );
    }

    const bar = unicode ? meter(ratio, barWidth) : meterAscii(ratio, barWidth);

    return (
        <Box width={width} overflow="hidden">
            <Text color={theme.label} wrap="truncate-end">{`${label.padEnd(labelCells)} `}</Text>
            <Text color={theme.muted}>[</Text>
            <Text color={rampStep(ramp, ratio)} wrap="truncate-end">{bar}</Text>
            <Text color={theme.muted}>]</Text>
            <Text color={theme.value} wrap="truncate-end">{` ${shown}`}</Text>
        </Box>
    );
});


function clamp01(value: number): number
{
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.max(0, Math.min(1, value));
}
