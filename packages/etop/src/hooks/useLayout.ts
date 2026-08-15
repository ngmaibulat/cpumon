/**
 * Which panels exist, and where they go.
 *
 * Two separate questions, in this order, and conflating them is what produces
 * a dashboard with three empty boxes on a Mac.
 *
 * First: which panels are meaningful on this machine at all. A probe that says
 * 'not-applicable' or 'unsupported-platform' is not a panel with nothing in it,
 * it is a panel that should not exist here - so it is removed from the layout
 * entirely and the rest reflow into its space. This mirrors the rule
 * probeRow() already follows in libsysmon's own renderer. The actionable
 * failures - permission denied, missing file, parse error - keep their panel,
 * because a diagnostic tool that hides diagnostics is worse than useless.
 *
 * Second: how the surviving panels are arranged, which is purely about size.
 */

import type { SystemSnapshot } from 'libsysmon/system';

import { PANEL_ORDER } from '../state/types.js';
import type { PanelId } from '../state/types.js';


export type Rect = {
    panel: PanelId;
    width: number;
    height: number;
};


export type Layout = {
    kind: 'full' | 'single' | 'too-small';
    /** laid out left to right, top to bottom */
    rows: Rect[][];
    /** panels dropped because this machine has no such concept */
    absent: PanelId[];
    /** one line for the footer when something was dropped, or null */
    note: string | null;
};


export const MIN_COLUMNS = 40;

/** the rows the frame spends on itself: header, tab bar, footer */
export const CHROME_ROWS = 3;

/**
 * The smallest body computeLayout will arrange anything in.
 *
 * Body rows, not terminal rows - `rows` here has always been what is left after
 * the header and the footer, and comparing it against the whole terminal's
 * minimum meant a terminal at exactly the minimum got a 'too-small' layout with
 * no panels in it, drawn inside a frame that had already decided it was big
 * enough. Which showed up as a header, a footer, and nothing in between.
 */
const MIN_BODY_ROWS = 8;

/**
 * The smallest terminal the dashboard will draw in.
 *
 * Eleven rather than ten because the frame now spends three rows on itself
 * rather than two, and eight is the least a bordered panel can show and still
 * have an interior worth reading.
 */
export const MIN_ROWS = MIN_BODY_ROWS + CHROME_ROWS;

/** below this a panel has no interior worth drawing */
const MIN_PANEL_HEIGHT = 4;
const MIN_PANEL_WIDTH = 20;


type ProbeLike = { available: boolean; reason?: string } | undefined;


/**
 * Whether a panel belongs on this machine.
 *
 * `undefined` means the collector was not asked, which the dashboard never
 * does - but a snapshot that has not arrived yet has every field undefined,
 * and dropping every panel on the first frame would be the worst possible
 * first impression. So absence before the first tick means "wait", not "no".
 */
export function isAbsent(probe: ProbeLike, sampled: boolean): boolean
{
    if (!sampled || probe === undefined) {
        return false;
    }

    if (probe.available) {
        return false;
    }

    return probe.reason === 'not-applicable' || probe.reason === 'unsupported-platform';
}


export function presentPanels(snapshot: SystemSnapshot | null): { present: PanelId[]; absent: PanelId[] } {
    const sampled = snapshot !== null;

    const absent: PanelId[] = [];

    // cpu and memory are never probes - os.cpus() and the memory collector
    // both always answer - so those two panels always exist
    if (isAbsent(snapshot?.disk as ProbeLike, sampled)) {
        absent.push('disk');
    }

    if (isAbsent(snapshot?.network as ProbeLike, sampled)) {
        absent.push('network');
    }

    if (isAbsent(snapshot?.processes as ProbeLike, sampled)) {
        absent.push('process');
    }

    // containers are different: an available probe with an empty list means
    // "this machine runs no containers", which is not worth a panel either
    const containers = snapshot?.containers;

    if (isAbsent(containers as ProbeLike, sampled)
        || (sampled && containers?.available === true && containers.containers.length === 0)) {
        absent.push('container');
    }

    return {
        present: PANEL_ORDER.filter(panel => !absent.includes(panel)),
        absent,
    };
}


/**
 * The order panels are given up as height runs out.
 *
 * Least to most valuable: containers are a specialist view, disk changes by
 * the hour, network by the second, and the process table is what most people
 * opened the dashboard for.
 */
const DROP_ORDER: PanelId[] = ['container', 'disk', 'network', 'memory', 'process', 'cpu'];


export function computeLayout(
    columns: number,
    rows: number,
    snapshot: SystemSnapshot | null,
    options: { focus: PanelId; maximised: boolean },
): Layout
{
    const { present, absent } = presentPanels(snapshot);
    const note = absentNote(absent, snapshot);

    if (columns < MIN_COLUMNS || rows < MIN_BODY_ROWS) {
        return { kind: 'too-small', rows: [], absent, note };
    }

    if (options.maximised) {
        return {
            kind: 'single',
            rows: [[{ panel: options.focus, width: columns, height: rows }]],
            absent,
            note,
        };
    }

    // below this there is room for one panel at a time and Tab is how you see
    // the others - which is a usable dashboard, unlike six panels three rows tall
    if (columns < 80 || rows < 16) {
        return {
            kind: 'single',
            rows: [[{ panel: options.focus, width: columns, height: rows }]],
            absent,
            note,
        };
    }

    return { kind: 'full', rows: arrange(columns, rows, present), absent, note };
}


/**
 * Place the surviving panels.
 *
 * Three bands: cpu and memory across the top, network and disk in the middle,
 * processes and containers filling what is left. Each band is dropped whole if
 * its height would fall below what a panel can usefully show, in DROP_ORDER.
 */
function arrange(columns: number, rows: number, present: PanelId[]): Rect[][]
{
    const has = (panel: PanelId) => present.includes(panel);

    // the bands, most valuable last so the survivor of a squeeze is the right one
    const bands: { panels: PanelId[]; weight: number }[] = [];

    const top = (['cpu', 'memory'] as PanelId[]).filter(has);

    if (top.length > 0) {
        bands.push({ panels: top, weight: 3 });
    }

    const middle = (['network', 'disk'] as PanelId[]).filter(has);

    if (middle.length > 0) {
        bands.push({ panels: middle, weight: 2 });
    }

    const bottom = (['process', 'container'] as PanelId[]).filter(has);

    if (bottom.length > 0) {
        bands.push({ panels: bottom, weight: 4 });
    }

    if (bands.length === 0) {
        return [];
    }

    // drop whole bands while the thinnest would be unusable
    let kept = bands;

    while (kept.length > 1 && rows / kept.length < MIN_PANEL_HEIGHT) {
        const victim = DROP_ORDER.find(panel => kept.some(band => band.panels.includes(panel)));

        kept = kept
            .map(band => ({ ...band, panels: band.panels.filter(panel => panel !== victim) }))
            .filter(band => band.panels.length > 0);
    }

    const totalWeight = kept.reduce((sum, band) => sum + band.weight, 0);

    // distribute rows by weight, giving the remainder to the last band so the
    // heights sum to exactly the space available
    let used = 0;

    return kept.map((band, i) => {
        const height = i === kept.length - 1
            ? rows - used
            : Math.max(MIN_PANEL_HEIGHT, Math.floor((band.weight / totalWeight) * rows));

        used += height;

        return splitRow(band.panels, columns, height);
    });
}


function splitRow(panels: PanelId[], columns: number, height: number): Rect[]
{
    if (panels.length === 1 || columns < MIN_PANEL_WIDTH * 2) {
        return [{ panel: panels[0], width: columns, height }];
    }

    const each = Math.floor(columns / panels.length);

    return panels.map((panel, i) => ({
        panel,
        // the last one takes the remainder, so the row is exactly `columns`
        width: i === panels.length - 1 ? columns - each * (panels.length - 1) : each,
        height,
    }));
}


/**
 * One dim line explaining what is missing.
 *
 * Removing a panel silently looks like a bug; saying so once costs a line and
 * answers the question before it is asked.
 */
function absentNote(absent: PanelId[], snapshot: SystemSnapshot | null): string | null
{
    if (snapshot === null || absent.length === 0) {
        return null;
    }

    const unsupported = absent.filter(panel => panel === 'network' || panel === 'process');

    if (unsupported.length > 0) {
        return `${unsupported.join(' and ')} need /proc, which this platform has not got`;
    }

    return null;
}
