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
    /**
     * Width reserved for the value.
     *
     * Without it a grid of gauges has ragged bars, because a core at 100% has
     * a four-character figure and one at 0% has two - so the bar beside it is
     * two cells longer, and a column of them looks broken rather than tidy.
     */
    valueWidth?: number;
};


export const Gauge = memo(function Gauge({
    label,
    ratio,
    width,
    ramp,
    value,
    labelWidth,
    valueWidth,
}: GaugeProps)
{
    const { theme, unicode } = useStyle();

    const percentage = `${Math.round(clamp01(ratio) * 100)}%`;

    // an empty label takes no room at all, rather than a stray leading space
    const labelCells = labelWidth ?? label.length;
    const prefix = labelCells === 0 ? '' : label.padEnd(labelCells);

    const pad = (text: string) => (valueWidth === undefined ? text : text.padStart(valueWidth));

    /**
     * A byte figure cut short does not read as an approximation, it reads as a
     * different unit: `16.0 G…` is not "about 16 GiB", it is unreadable. So a
     * value that will not fit is replaced by the percentage, which always fits
     * and is never wrong - rather than truncated.
     */
    const rich = pad(value ?? percentage);
    const room = width - prefix.length - (prefix === '' ? 0 : 1);
    const shown = rich.length <= room ? rich : pad(percentage);

    // brackets make the bar's extent unambiguous when it is nearly empty, which
    // is otherwise indistinguishable from a bar that failed to draw
    const barWidth = Math.max(0, room - shown.length - 3);

    const labelNode = prefix === ''
        ? null
        : <Text color={theme.label} wrap="truncate-end">{prefix}</Text>;

    if (barWidth < 1) {
        // no room for a bar; the figure is the part worth keeping. The space
        // leads the value rather than trailing the label, because ink trims
        // trailing whitespace off a Text and the two would run together.
        return (
            <Box width={width} overflow="hidden">
                {labelNode}
                <Text color={rampStep(ramp, ratio)} wrap="truncate-end">
                    {`${prefix === '' ? '' : ' '}${shown}`}
                </Text>
            </Box>
        );
    }

    const bar = unicode ? meter(ratio, barWidth) : meterAscii(ratio, barWidth);

    return (
        <Box width={width} overflow="hidden">
            {labelNode}
            <Text color={theme.muted}>{`${prefix === '' ? '' : ' '}[`}</Text>
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
