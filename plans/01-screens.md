# Phase 01 — Screens

> **Status: shipped** in `@aibulat/etop` 0.2.0.
> This document is kept because phases 02–05 all plug into the seams it created.

## What it solved

`etop` was a single screen. Every panel — cpu, memory, disk, network, process,
container — competed for the same frame, `Tab` cycled which one had focus, and
`f` maximised the focused one. The only things that replaced the frame were the
help and kill overlays.

That was the ceiling. The views wanted next — systemd units, compose stacks,
connections, wifi — are all *lists*, and a list is worthless in a four-row tile.
`computeLayout` already drops whole bands once `rows / bands` falls below four,
so adding four more panels to `PANEL_ORDER` would mostly have added things that
get dropped.

So: a **screen** axis above the panel axis.

## The seams later phases use

### `ScreenId` and `SCREEN_PANEL` — `src/state/types.ts`

```ts
export type ScreenId = 'dash' | 'proc' | 'units' | 'containers' | 'stacks' | 'conn' | 'wifi';
export const SCREEN_ORDER: ScreenId[] = [...];
export const SCREEN_LABELS: Record<ScreenId, string> = {...};
export const SCREEN_PANEL: Partial<Record<ScreenId, PanelId>> = { proc: 'process', containers: 'container' };
```

**All seven screens already exist.** A later phase does not add a screen — it
replaces a placeholder. What it must add is an entry in `SCREEN_PANEL`, and a
`PanelId` for it to point at.

`SCREEN_PANEL` is not bookkeeping. `activePanel(state)` in `src/state/keymap.ts`
resolves panel bindings against it:

```ts
export function activePanel(state: UiState): PanelId | null
{
    return state.screen === 'dash' ? state.focus : SCREEN_PANEL[state.screen] ?? null;
}
```

That one indirection is why the full-screen process table reuses every process
binding — `j`, `/`, `Enter`, `K` — without a duplicated entry, and why a screen
with no panel yet lets its keys fall through to the globals rather than
swallowing them.

### `LIST_BINDINGS` — cursor keys are already done

`Binding.panel` accepts a `PanelId` **or an array of them**. `LIST_BINDINGS`
names `LIST_PANELS = ['process', 'container']`, and covers `j/k`, `↑/↓`,
`Ctrl-D`/`Ctrl-U`, `PgUp`/`PgDn`, `g`/`G`, `Home`/`End` for all of them at once.

A new list panel gets working cursor keys by adding its `PanelId` to
`LIST_PANELS`. It does not need bindings of its own unless it has keys of its
own.

### `onRows` — the geometry contract

The reducer cannot know how many rows a list has or how many fit; both depend on
data and on layout. So the panel tells it:

```ts
onRows?: (rowCount: number, windowRows: number) => void;   // App dispatches { type: 'clamp', ... }
```

Two rules a new list panel must follow, both learned the hard way in this phase:

1. **`windowRows` must be the number of rows actually drawn**, not the panel
   height. `Panel` spends two rows on its border and one on its title; a `Table`
   spends one more on its header. One too many and `G` puts the cursor below the
   last visible row and the list looks stuck.
2. **The effect must depend on `selected` and `scroll`**, even though the report
   does not carry them. `G` sets the selection to an index no list could contain
   and leaves the reducer to clamp it — which it can only do once something
   tells it the row count. `clamp` returns the state unchanged when there is
   nothing to fix, so the pass that follows a move settles at once.

`onView` is the process table's own, wider callback; it also carries the
selected row because the kill modal reads it to pin a pid. Nothing else should
write it. New screens use `onRows`.

### Per-screen cursors

`UiState.savedCursors` holds where the cursor was on each screen that has been
left. Selection itself stays a flat `selected`/`scroll` pair so no action had to
learn what a screen is — only `toScreen` in the reducer saves the outgoing pair
and restores the incoming one. A new screen gets this for free.

### `Placeholder` — `src/panels/Placeholder.tsx`

The `PENDING` table names, for each unbuilt screen, what it will show and which
collector it waits on. **Deleting a screen's entry there is the last step of the
phase that builds it**, and `test/screens.test.js` asserts that every screen
without a `SCREEN_PANEL` entry has a `PENDING` one — so the two cannot drift.

### Frame geometry

`CHROME_ROWS = 3` — header, tab bar, footer — exported from `hooks/useLayout.ts`
and used by `App` for every body-height calculation. A frame one line taller
than the terminal scrolls the alternate screen, and that damage does not wash
out on the next frame, so there is exactly one figure and everything reads it.

## What also changed

- `Tab` / `Shift-Tab` cycle screens. Panel focus moved to `w` / `W`.
- `1`–`6`, `w` / `W` and `f` return `null` off the dashboard rather than moving a
  focus nobody can see.
- `Esc` gained a last rung: with nothing left to close, it returns to the dashboard.
- `ContainerPanel` takes a cursor and scrolls.
- `ProcessPanel` rounds its `setTop` request up to a multiple of 32, so moving
  the table between a dashboard tile and a full screen no longer respawns the
  monitor and throws away a sampling window.
- **Bug fix:** `computeLayout`'s minimum was compared against *body* rows while
  `MIN_ROWS` describes the *terminal*, so a terminal at exactly the minimum drew
  a header, a footer and nothing between them. Now `MIN_ROWS = MIN_BODY_ROWS +
  CHROME_ROWS`.

## Known, pre-existing, not fixed

Both reproduce on 0.1.2 and are unrelated to this phase:

- The last band's bottom border can be missing at some heights, and the help
  overlay pushes the header off the top leaving a stale line behind. `HelpOverlay`
  renders its exact height under `renderToString`, so this is an ink
  incremental-rendering artifact rather than a layout error. Fixing it means
  disabling `incrementalRendering` — which is what keeps redraws from flickering
  — or working around ink internals.
- `packages/etop/test/keymap.test.js` contains a literal NUL byte where `' '`
  was presumably meant (`['z', 'Z', '@', '\x00']`), which is why git renders
  that file as binary in diffs.
