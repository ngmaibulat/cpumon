/**
 * systemd units.
 *
 * A units screen exists mostly to answer "what is broken", so failed units sort
 * to the top and are coloured with theme.danger. Everything else follows the
 * order systemd gave, which is alphabetical by name.
 *
 * ## Why this screen filters by default
 *
 * A real machine has 475 loaded units and 179 of them are `.device` and
 * `.mount` entries created by udev for every disk, partition and hidraw node on
 * the box. Showing all of them by default would mean the first screenful is
 * always `dev-disk-by\x2did-nvme\x2deui.…` and never anything anybody came to
 * read. So the default is `.service`, `.socket` and `.timer`, `a` turns the
 * rest on, and the subtitle says which is in force - a filtered list that does
 * not admit it is filtered is the thing this codebase refuses to draw.
 */

import { Box, Text } from 'ink';
import { memo, useEffect, useMemo } from 'react';
import { isAvailable } from 'libsysmon';
import type { SystemdUnit } from 'libsysmon';

import { Loading } from '../ui/Loading.js';
import { Panel } from '../ui/Panel.js';
import { Table } from '../ui/Table.js';
import { Unavailable } from '../ui/Unavailable.js';
import { useSlowState } from '../hooks/useSlow.js';
import { useStyle } from '../hooks/useTheme.js';
import type { Column } from '../render/columns.js';
import type { Theme } from '../theme/index.js';


export type UnitPanelProps = {
    width: number;
    height: number;
    focused?: boolean;
    selected?: number;
    scroll?: number;
    /** show every unit type rather than the interesting few */
    allTypes?: boolean;
    /** the committed name/description filter; empty means none */
    filter?: string;
    onRows?: (rowCount: number, windowRows: number) => void;
};


/** what someone opening a units screen came to look at */
export const DEFAULT_TYPES = ['service', 'socket', 'timer'];


const COLUMNS: Column[] = [
    { key: 'name', header: 'UNIT', align: 'left', min: 18, priority: 100 },
    { key: 'load', header: 'LOAD', align: 'left', min: 6, priority: 40 },
    { key: 'active', header: 'ACTIVE', align: 'left', min: 8, priority: 90 },
    { key: 'sub', header: 'SUB', align: 'left', min: 7, priority: 70 },
    { key: 'description', header: 'DESCRIPTION', align: 'left', min: 12, flex: true, priority: 50 },
];


/**
 * Failed first, then the order systemd gave.
 *
 * Only failed is promoted. Sorting by state generally would scatter a service
 * and its socket to opposite ends of the list, and the alphabetical order is
 * what makes a unit findable by eye.
 */
export function compareUnits(a: SystemdUnit, b: SystemdUnit): number
{
    const broken = Number(b.activeState === 'failed') - Number(a.activeState === 'failed');

    return broken !== 0 ? broken : a.name.localeCompare(b.name);
}


export function matchesUnit(unit: SystemdUnit, filter: string): boolean
{
    if (filter === '') {
        return true;
    }

    const needle = filter.toLowerCase();

    return unit.name.toLowerCase().includes(needle)
        || unit.description.toLowerCase().includes(needle);
}


/**
 * The rows to draw: type filter, then text filter, then order.
 *
 * Pure and exported, because the interesting assertions are about which units
 * survive rather than about pixels.
 *
 * A failed unit is never hidden by the type filter. A machine whose only broken
 * thing is a `.mount` would otherwise show a clean screen while being broken,
 * which is the exact failure the screen exists to prevent.
 */
export function selectUnits(units: SystemdUnit[], allTypes = false, filter = ''): SystemdUnit[]
{
    const wanted = units.filter(unit => {
        if (!allTypes && !DEFAULT_TYPES.includes(unit.type) && unit.activeState !== 'failed') {
            return false;
        }

        return matchesUnit(unit, filter);
    });

    return wanted.sort(compareUnits);
}


export function toRow(unit: SystemdUnit): string[]
{
    return [
        unit.name,
        unit.loadState,
        unit.activeState,
        // a queued job is what the unit is about to become, and saying so is
        // more useful than a sub-state that is already stale
        unit.jobType === undefined ? unit.subState : `${unit.subState} (${unit.jobType})`,
        unit.description,
    ];
}


export const UnitPanel = memo(function UnitPanel({
    width,
    height,
    focused = false,
    selected,
    scroll = 0,
    allTypes = false,
    filter = '',
    onRows,
}: UnitPanelProps)
{
    const { units: probe, ticks } = useSlowState();
    const { theme, glyphs } = useStyle();

    const all = probe !== undefined && isAvailable(probe) ? probe.units : undefined;

    const units = useMemo(
        () => (all === undefined ? [] : selectUnits(all, allTypes, filter)),
        [all, allTypes, filter],
    );

    const failed = units.filter(unit => unit.activeState === 'failed').length;

    // Panel spends two rows on its border and one on its title; the table
    // spends one more on its header. What is left is what a cursor can stand on.
    const bodyRows = Math.max(0, height - 4);

    // selected and scroll are dependencies even though the report does not
    // carry them: `G` sets the selection past the end and leaves the reducer to
    // clamp it, which it can only do once something tells it the row count.
    useEffect(() => {
        onRows?.(units.length, bodyRows);
    }, [onRows, units.length, bodyRows, selected, scroll]);

    return (
        <Panel
            title="UNITS"
            subtitle={all === undefined ? undefined : subtitle(units.length, failed, allTypes, glyphs.separator)}
            width={width}
            height={height}
            focused={focused}
        >
            {({ width: inner, height: innerHeight }) => {
                if (probe === undefined) {
                    return <Loading width={inner} height={innerHeight} />;
                }

                if (!isAvailable(probe)) {
                    return <Unavailable reason={probe.reason} detail={probe.detail} width={inner} height={innerHeight} />;
                }

                if (units.length === 0) {
                    return ticks < 1
                        ? <Loading width={inner} height={innerHeight} />
                        : (
                            <Text color={theme.muted} wrap="truncate-end">
                                {filter === '' ? 'no loaded units' : `no unit matches ${filter}`}
                            </Text>
                        );
                }

                return (
                    <Box flexDirection="column" width={inner} height={innerHeight} overflow="hidden">
                        <Table
                            columns={COLUMNS}
                            rows={units.map(toRow)}
                            width={inner}
                            height={innerHeight}
                            selected={selected}
                            offset={scroll}
                            rowColor={index => rowColor(units[index], theme)}
                        />
                    </Box>
                );
            }}
        </Panel>
    );
});


/**
 * What the header says about what is being shown.
 *
 * The type filter is named rather than implied: a list that has quietly hidden
 * three hundred rows and does not say so is worse than one that shows them.
 */
function subtitle(shown: number, failed: number, allTypes: boolean, separator: string): string
{
    const scope = allTypes ? 'all types' : DEFAULT_TYPES.join('/');
    const broken = failed === 0 ? '' : ` ${separator} ${failed} failed`;

    return `${shown} loaded ${separator} ${scope}${broken}`;
}


function rowColor(unit: SystemdUnit | undefined, theme: Theme): string | undefined
{
    if (unit === undefined) {
        return undefined;
    }

    if (unit.activeState === 'failed') {
        return theme.danger ?? theme.warn;
    }

    // inactive is not a problem, but it is not running either, and a list where
    // dead and running look identical answers nothing
    return unit.activeState === 'active' ? theme.value : theme.muted;
}
