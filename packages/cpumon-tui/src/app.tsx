/**
 * The layout root.
 *
 * Still a scaffold - the panels arrive next - but the shape is already
 * load-bearing. One useInput at the root, an explicit width AND height on the
 * root Box, and overflow hidden.
 *
 * The explicit height is not a detail. Without it ink lets content size the
 * frame, and a frame one line taller than the terminal scrolls it - which in
 * the alternate screen means the top line is gone for good and every subsequent
 * frame is drawn one row off. Clamping here is what makes a layout bug show up
 * as a missing row rather than a corrupted screen.
 */

import { Box, Text, useApp, useInput, useWindowSize } from 'ink';

import { useStore, useStoreState } from './hooks/useStore.js';
import { CpuPanel } from './panels/CpuPanel.js';
import { DiskPanel } from './panels/DiskPanel.js';
import { MemoryPanel } from './panels/MemoryPanel.js';
import type { Capabilities } from './term/capabilities.js';


export type AppProps = {
    capabilities: Capabilities;
    allowKill: boolean;
};


/** below this the dashboard has nothing useful to say, so it says that instead */
export const MIN_COLUMNS = 40;
export const MIN_ROWS = 10;

/** faster than this and the cost of sampling shows up in the sample */
const MIN_INTERVAL_MS = 100;
const MAX_INTERVAL_MS = 10_000;


export function App({ capabilities }: AppProps)
{
    const { columns, rows } = useWindowSize();
    const { exit } = useApp();
    const store = useStore();
    const { paused, intervalMs } = useStoreState();

    useInput((input, key) => {
        if (input === 'q' || (key.ctrl && input === 'c')) {
            exit();

            return;
        }

        if (input === ' ') {
            store.setPaused(!paused);

            return;
        }

        // doubling rather than stepping: the useful range spans two orders of
        // magnitude, and a linear step would need thirty presses to cross it
        if (input === '+' || input === '=') {
            store.setIntervalMs(Math.max(MIN_INTERVAL_MS, Math.round(intervalMs / 2)));

            return;
        }

        if (input === '-') {
            store.setIntervalMs(Math.min(MAX_INTERVAL_MS, intervalMs * 2));

            return;
        }

        if (input === 'r') {
            store.reset();
            store.setPaused(false);
        }
    });

    if (columns < MIN_COLUMNS || rows < MIN_ROWS) {
        return <TooSmall columns={columns} rows={rows} />;
    }

    return (
        <Box flexDirection="column" width={columns} height={rows} overflow="hidden">
            <Box justifyContent="space-between">
                <Text bold>cpumon-tui</Text>
                <Text dimColor>
                    {`${columns}x${rows} · ${capabilities.graph} · colour ${capabilities.colorLevel}`}
                </Text>
            </Box>
            <Box flexGrow={1} overflow="hidden">
                {/* a placeholder split until useLayout arrives in the next
                    milestone; the panels themselves are already responsive */}
                <CpuPanel width={Math.floor(columns / 2)} height={rows - 2} />
                <Box flexDirection="column" width={columns - Math.floor(columns / 2)} overflow="hidden">
                    <MemoryPanel width={columns - Math.floor(columns / 2)} height={Math.floor((rows - 2) / 2)} />
                    <DiskPanel
                        width={columns - Math.floor(columns / 2)}
                        height={(rows - 2) - Math.floor((rows - 2) / 2)}
                    />
                </Box>
            </Box>
            <Text dimColor wrap="truncate-end">
                {'q quit · space pause · +/- interval · r reset'}
            </Text>
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
