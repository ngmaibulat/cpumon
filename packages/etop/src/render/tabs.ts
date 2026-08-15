/**
 * Fitting a tab bar into the width it has.
 *
 * Pure, for the same reason columns.ts is: what a bar does when it runs out of
 * room is a decision with several defensible answers, and the only way to hold
 * one of them still is to test it as a table of values.
 *
 * The rule it holds to is that the active tab is never the thing that gets
 * dropped. A bar that silently loses the tab you are standing on is worse than
 * no bar - it says the screen you are looking at does not exist. So the window
 * of visible tabs is grown outwards from the active one until the next tab
 * would not fit, and the ends that were cut carry a marker saying so.
 *
 * The labels come in already short (see SCREEN_LABELS) rather than being
 * truncated here, because a tab bar of ellipsed stubs is unreadable in a way a
 * shorter list of whole words is not.
 */

import { SCREEN_LABELS, SCREEN_ORDER } from '../state/types.js';
import type { ScreenId } from '../state/types.js';


export type Tab = {
    screen: ScreenId;
    label: string;
    active: boolean;
};


export type TabLayout = {
    tabs: Tab[];
    /** tabs exist before the first one shown */
    moreBefore: boolean;
    /** tabs exist after the last one shown */
    moreAfter: boolean;
};


/** two spaces between tabs, so the inverse-video active tab has a visible edge */
export const TAB_GAP = 2;


/**
 * The width one tab occupies, including the gap that precedes it.
 *
 * The active tab is padded by one space on each side, because it is drawn in
 * inverse video and a highlight flush against the label is hard to read.
 */
function widthOf(label: string, active: boolean, first: boolean): number
{
    return label.length + (active ? 2 : 0) + (first ? 0 : TAB_GAP);
}


/**
 * Which tabs fit, centred on the active one.
 *
 * Grows right first and then left, so the common case - the active tab near the
 * start - reads left-aligned rather than drifting to the middle of the bar.
 */
export function fitTabs(active: ScreenId, width: number, screens: ScreenId[] = SCREEN_ORDER): TabLayout
{
    const activeIndex = Math.max(0, screens.indexOf(active));

    if (width < 1 || screens.length === 0) {
        return { tabs: [], moreBefore: false, moreAfter: false };
    }

    const label = (index: number) => SCREEN_LABELS[screens[index]];

    // the marker columns have to be reserved before anything is placed, or the
    // last tab to fit pushes the marker off the end and the bar lies about
    // having shown everything
    let first = activeIndex;
    let last = activeIndex;
    let used = widthOf(label(activeIndex), true, true);

    if (used + markerCost(activeIndex > 0, activeIndex < screens.length - 1) > width) {
        // not even one tab and its markers fit; show the active label alone and
        // let ink truncate it, which is still the one useful fact
        return {
            tabs: [{ screen: screens[activeIndex], label: label(activeIndex), active: true }],
            moreBefore: activeIndex > 0,
            moreAfter: activeIndex < screens.length - 1,
        };
    }

    for (;;) {
        const canGrowRight = last < screens.length - 1;
        const canGrowLeft = first > 0;

        if (!canGrowRight && !canGrowLeft) {
            break;
        }

        const grewRight = canGrowRight
            && tryGrow(used + widthOf(label(last + 1), false, false), first > 0, last + 1 < screens.length - 1, width);

        if (grewRight) {
            used += widthOf(label(last + 1), false, false);
            last++;

            continue;
        }

        const grewLeft = canGrowLeft
            && tryGrow(used + widthOf(label(first - 1), false, false), first - 1 > 0, last < screens.length - 1, width);

        if (grewLeft) {
            used += widthOf(label(first - 1), false, false);
            first--;

            continue;
        }

        break;
    }

    const tabs: Tab[] = [];

    for (let i = first; i <= last; i++) {
        tabs.push({ screen: screens[i], label: label(i), active: i === activeIndex });
    }

    return { tabs, moreBefore: first > 0, moreAfter: last < screens.length - 1 };
}


/** a marker is one glyph plus the space separating it from the tabs */
function markerCost(before: boolean, after: boolean): number
{
    return (before ? 2 : 0) + (after ? 2 : 0);
}


function tryGrow(used: number, moreBefore: boolean, moreAfter: boolean, width: number): boolean
{
    return used + markerCost(moreBefore, moreAfter) <= width;
}
