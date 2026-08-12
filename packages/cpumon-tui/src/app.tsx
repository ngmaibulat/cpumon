/**
 * The layout root.
 *
 * Skeleton for now - the panels arrive over the next few milestones. What is
 * already load-bearing is the shape: one useInput at the root, an explicit
 * width AND height on the root Box, and overflow hidden.
 *
 * The explicit height is not a detail. Without it Ink lets content size the
 * frame, and a frame one line taller than the terminal scrolls it - which in
 * the alternate screen means the top line is gone for good and every subsequent
 * frame is drawn one row off. Clamping here is what makes a layout bug show up
 * as a missing row instead of a corrupted screen.
 */

import { Box, Text, useApp, useInput, useWindowSize } from 'ink';

import type { Capabilities } from './term/capabilities.js';


export type AppProps = {
    capabilities: Capabilities;
};


/** below this the dashboard has nothing useful to say, so it says that instead */
export const MIN_COLUMNS = 40;
export const MIN_ROWS = 10;


export function App({ capabilities }: AppProps)
{
    const { columns, rows } = useWindowSize();
    const { exit } = useApp();

    useInput((input, key) => {
        if (input === 'q' || (key.ctrl && input === 'c')) {
            exit();
        }
    });

    if (columns < MIN_COLUMNS || rows < MIN_ROWS) {
        return <TooSmall columns={columns} rows={rows} />;
    }

    return (
        <Box flexDirection="column" width={columns} height={rows} overflow="hidden">
            <Text bold>cpumon-tui</Text>
            <Box flexGrow={1}>
                <Text dimColor>
                    {`${columns}x${rows} · ${capabilities.graph} graphs · colour level ${capabilities.colorLevel}`}
                </Text>
            </Box>
            <Text dimColor>q quit</Text>
        </Box>
    );
}


function TooSmall({ columns, rows }: { columns: number; rows: number })
{
    // deliberately plain: at this size a bordered box would spend most of the
    // screen on its own border
    return (
        <Box flexDirection="column" width={columns} height={rows} overflow="hidden">
            <Text wrap="truncate-end">terminal too small</Text>
            <Text wrap="truncate-end" dimColor>
                {`need ${MIN_COLUMNS}x${MIN_ROWS}, have ${columns}x${rows}`}
            </Text>
        </Box>
    );
}
