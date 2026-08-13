/**
 * Filesystem usage.
 *
 * One mount, because that is what libsysmon's collector reads. btop lists every
 * mounted filesystem, and this panel will too once there is a getMounts() to
 * ask - but the honest version of "we only know about one" is to say so in the
 * panel, not to leave the space looking like it failed to fill.
 *
 * The same goes for I/O rates. There is no /proc/diskstats collector, so there
 * is no read/write graph, and a suspiciously empty half-panel invites the
 * reader to wonder what broke. One dim line costs nothing and answers it.
 */

import { Box, Text } from 'ink';
import { memo } from 'react';
import { bytes } from 'libsysmon/format';
import { isAvailable } from 'libsysmon';

import { Gauge } from '../ui/Gauge.js';
import { Loading } from '../ui/Loading.js';
import { Panel } from '../ui/Panel.js';
import { Unavailable } from '../ui/Unavailable.js';
import { rampStep } from '../theme/ramp.js';
import { useStoreState } from '../hooks/useStore.js';
import { useStyle } from '../hooks/useTheme.js';


export type DiskPanelProps = {
    width: number;
    height: number;
    focused?: boolean;
};


export const DiskPanel = memo(function DiskPanel({ width, height, focused = false }: DiskPanelProps)
{
    const { snapshot } = useStoreState();
    const { theme } = useStyle();

    const probe = snapshot?.disk;
    const disk = probe !== undefined && isAvailable(probe) ? probe.disk : null;

    return (
        <Panel
            title="DISK"
            subtitle={disk?.mount}
            width={width}
            height={height}
            focused={focused}
            badge={
                <Text color={rampStep(theme.disk, disk?.usedRatio ?? 0)} bold>
                    {disk === null ? '' : `${disk.usedPercentage}%`}
                </Text>
            }
        >
            {({ width: inner, height: innerHeight }) => {
                if (probe === undefined) {
                    return <Loading width={inner} height={innerHeight} />;
                }

                if (!isAvailable(probe)) {
                    return <Unavailable reason={probe.reason} detail={probe.detail} width={inner} height={innerHeight} />;
                }

                const { disk: info } = probe;

                return (
                    <Box flexDirection="column" width={inner} height={innerHeight} overflow="hidden">
                        <Gauge
                            label=""
                            ratio={info.usedRatio}
                            width={inner}
                            ramp={theme.disk}
                            labelWidth={0}
                            value={`${bytes(info.used)} / ${bytes(info.size)}`}
                        />
                        {innerHeight < 2 ? null : (
                            <Text color={theme.label} wrap="truncate-end">
                                {`free ${bytes(info.available)}`}
                            </Text>
                        )}
                        {innerHeight < 4 ? null : (
                            <>
                                <Box flexGrow={1} />
                                <Text color={theme.muted} dimColor wrap="truncate-end">
                                    I/O rates need a diskstats collector
                                </Text>
                            </>
                        )}
                    </Box>
                );
            }}
        </Panel>
    );
});
