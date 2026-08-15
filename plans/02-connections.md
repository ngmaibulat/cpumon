# Phase 02 — Connections

> **Status: shipped** in `@aibulat/etop` 0.3.0 / `libsysmon` 0.6.0.
> Built as designed except for the two departures recorded at the bottom.

## Why this one first

Every other remaining phase needs infrastructure that does not exist yet — an
asynchronous sampling path, a D-Bus client. This one needs a `readFileSync` and
a parser, which is what every collector in `libsysmon` already is. It ships
alone, on the existing synchronous `SystemMonitor` tick, and it proves the
`Placeholder` → real screen path end to end before anything harder is attempted.

## The source

`/proc/net/tcp`, `/proc/net/tcp6`, `/proc/net/udp`, `/proc/net/udp6`. Four files,
same column layout, roughly 90 lines total on this machine:

```
  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:A6E3 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 21562 2 ...
   1: 0100007F:2406 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 5798454 1 ...
```

The v6 files use the same layout with a 32-hex-digit address:

```
   0: 00000000000000000000000000000000:15B3 00000000000000000000000000000000:0000 0A ...
```

Three things about this format are traps rather than details.

**Addresses are little-endian hex, per 32-bit word.** `0100007F` is `127.0.0.1`,
not `1.0.0.127`. For v6 it is four words, each individually byte-swapped — which
is why a naive "reverse the whole string" produces addresses that look plausible
and are wrong. Get this wrong and the screen quietly lies about which host a
socket is talking to.

**The port is big-endian hex.** `A6E3` is 42723, `01BB` is 443. Opposite
convention to the address in the same field, separated by a colon.

**`st` is a hex TCP state, not a string.** `0A` is LISTEN, `01` ESTABLISHED. UDP
reuses the column with a much smaller vocabulary (`07` is effectively
"unconnected"). The table is short and belongs in the collector, not in the
panel.

## Owner resolution, and the honest version of it

The `inode` column is a socket inode. Mapping it to a process means scanning
`/proc/<pid>/fd` and reading every symlink looking for `socket:[<inode>]`.

Measured on this machine, as an ordinary user:

```
pids=557  readable=159  denied=398  fds=5998  sockets=1316  elapsed=0.032s
```

Two conclusions, and the second is the important one.

**The scan is cheap.** 32 ms is affordable at a one-second interval and it is
only paid while the `conn` screen is showing.

**Most of it is not readable.** 398 of 557 processes denied `/proc/<pid>/fd` to a
non-root user. So the owner column will be blank for the majority of sockets on
a normal run, and blank means two entirely different things: *no process holds
this socket* (a `TIME_WAIT` remnant, genuinely ownerless) and *a process holds
it and you may not see which*. Presenting both as `-` is the kind of quiet
falsehood the rest of this codebase goes out of its way to avoid.

So `SocketOwner` is a three-state value, not an optional pid:

```ts
export type SocketOwner =
    | { kind: 'process'; pid: number; comm: string }
    | { kind: 'none' }                                  // scanned everything readable, nobody holds it
    | { kind: 'denied' };                               // some fd directories were unreadable
```

And the panel renders `denied` as something visibly different from `none` — a
dim `?` against a `-` — with a one-line footnote when any row is `denied`,
saying that running as root would fill them in. Same shape as `ContainerPanel`'s
`scope: 'namespaced'` footnote, and for the same reason.

## Files

### `packages/libsysmon/src/collectors/connections.ts` (new)

```ts
export type SocketProtocol = 'tcp' | 'tcp6' | 'udp' | 'udp6';

export type SocketState =
    | 'ESTABLISHED' | 'SYN_SENT' | 'SYN_RECV' | 'FIN_WAIT1' | 'FIN_WAIT2'
    | 'TIME_WAIT' | 'CLOSE' | 'CLOSE_WAIT' | 'LAST_ACK' | 'LISTEN' | 'CLOSING'
    | 'UNKNOWN';

export type Connection = {
    protocol: SocketProtocol;
    localAddress: string;
    localPort: number;
    remoteAddress: string;
    remotePort: number;
    state: SocketState;
    uid: number;
    inode: number;
    txQueue: number;
    rxQueue: number;
    owner?: SocketOwner;   // absent until resolveOwners() has been asked for it
};

/** pure: one file's text in, rows out */
export function parseNetSockets(text: string, protocol: SocketProtocol): Connection[];

/** reader: all four files, tolerating any of them being absent */
export function getConnections(options?: CollectorOptions): Probe<{ connections: Connection[] }>;

/** the expensive half, kept separate and opt-in */
export function resolveOwners(connections: Connection[], options?: CollectorOptions): Connection[];

/** exported for the panel's sort menu and for tests */
export const TCP_STATES: Record<string, SocketState>;
```

`parseNetSockets` is exported from `index.ts` alongside its reader, like every
other parser here, so the test suite covers it on a runner with no `/proc`.

A file that does not exist is not an error — a kernel built without IPv6 has no
`/proc/net/tcp6`, and that is a missing protocol rather than a failed collector.
Only all four missing is `not-found`.

### `packages/libsysmon/src/SystemMonitor.ts`

Add `'connection'` to `CollectorName` and `connections?: Probe<{ connections: Connection[] }>`
to `SystemSnapshot`. It is a point-in-time reading with no window to diff, so it
goes in `sampleSystem()` next to memory, load and disk — **not** into
`readBaseline`. There is no rate to compute here.

Do **not** call `resolveOwners` from `SystemMonitor`. See below.

### `packages/etop/src/panels/ConnectionPanel.tsx` (new)

Columns, in `render/columns.ts` priority order:

| key | header | notes |
| --- | --- | --- |
| `proto` | `PROTO` | tcp / tcp6 / udp / udp6 |
| `local` | `LOCAL` | `addr:port`, flex |
| `remote` | `REMOTE` | `addr:port`, flex, `-` when unconnected |
| `state` | `STATE` | highest priority after the addresses |
| `owner` | `PROCESS` | `comm` when known, `?` when denied, `-` when none |

Sort defaults to state then local port, so listeners group together — which is
what someone opening this screen is usually looking for.

### Owner resolution belongs to the panel, not the collector

`resolveOwners` runs in the panel, over the visible window only, and only while
the `conn` screen is showing. Three reasons:

1. Scanning every `/proc/<pid>/fd` on every tick to fill a column nobody is
   looking at is exactly the cost `ProcessPanel` already refuses to pay for
   resident memory on invisible rows.
2. `SystemMonitor` runs on a timer and is shared with the `cpumon` CLI, which
   has no concept of a visible window.
3. The scan builds one inode → pid map and can answer every visible row from it,
   so per-row cost is a `Map.get`.

`ProcessPanel`'s `store.setTop` bucketing is the precedent for the general shape:
the panel knows what is visible, so the panel decides what is worth reading.

## Registration

- `SCREEN_PANEL.conn = 'connection'`, add `'connection'` to `PanelId` and
  `PANEL_ORDER`... **except** it must not join `PANEL_ORDER`. That array is the
  dashboard's tile order and the `1`–`6` key mapping; a seventh entry would
  shift nothing but would put a connections tile on the dashboard, which is not
  wanted. Add the `PanelId` to the union and to `LIST_PANELS`, and leave
  `PANEL_ORDER` alone.
- Add `'connection'` to `COLLECTORS` in `packages/etop/src/index.ts`.
- Delete `PENDING.conn` from `panels/Placeholder.tsx`.

That `PANEL_ORDER` distinction is the one genuinely non-obvious registration
step, and it applies identically to phases 03–05.

## Tests

`packages/libsysmon/test/connections.test.js`, with a fixture tree at
`test/fixtures/proc/net/{tcp,tcp6,udp,udp6}`:

- Address decoding both ways round: `0100007F:0050` → `127.0.0.1:80`, and a v6
  line → the right colon-grouped address. This is the test that catches the
  endianness trap, so include a v6 address whose bytes are not palindromic.
- Every state code in `TCP_STATES`, plus an unknown one falling to `UNKNOWN`
  rather than throwing.
- A truncated or header-only file yielding `[]` rather than an error.
- Three of four files missing → still available, with the protocols that exist.
- All four missing → `not-found`.

`packages/etop/test/connections.test.js`:

- The three owner states render differently from each other.
- The `denied` footnote appears only when a row is `denied`.
- `assertFits` at several widths, and the ascii-only assertion every panel here
  carries.

## Effort

Small. One parser, one panel, no new infrastructure, no new dependency. The
endianness and the three-state owner are the only places to be careful.


## What actually happened

Two departures from the design above, and one bug it walked into.

### Owner resolution is not windowed

The design said `resolveOwners` should run over the visible window only. It runs
over the whole list instead, memoised on the snapshot.

The reasoning that produced the original rule is still right — the scan is
expensive and must not run when nobody is looking at the column — and that part
is unchanged, because only the `conn` screen mounts the panel. What the rule got
wrong is *where* the cost is. `resolveOwners` builds one inode → pid map over
every readable `/proc/<pid>/fd` whatever it is asked about, so restricting the
input trims a handful of `comm` reads and nothing else. Meanwhile keying the memo
on the window means every scroll that shifts it pays the ~50 ms scan again — a
visible hitch on `j` at the bottom of the list, traded for no saving.

Measured on this machine: 79 sockets, 52 ms for the scan, 39 owners found and 44
withheld.

### The panel takes a `resolve` seam

`ConnectionPanel` accepts an optional `resolve` prop defaulting to
`resolveOwners`. Without it the panel's own tests assert against whatever
happens to be listening on the machine running them, which is the exact failure
`CollectorOptions.procRoot` exists to prevent one layer down.

### `render/columns.ts` was silently misaligning dropped columns

Not part of this phase, found by it. `row()` walked `fitted.columns` and indexed
the cell array positionally, so once a column was dropped for want of width every
value after the gap was drawn one column to the left — a container's `CPUS`
figure under `MEM`, `MEM` under `LIMIT`.

Invisible by construction: the row was still exactly the panel's width and every
cell still held a plausible value for something. It affected `ProcessPanel` and
`ContainerPanel` at narrow widths in 0.1.x and 0.2.0.

`Fitted` now carries `indices`, the original position of each surviving column,
and `row()` indexes by that. `Table` builds its header row over all columns
rather than the survivors, so both arrays follow the same convention.

### Also worth knowing

- IPv6 endpoints are bracketed — `[::]:443` — which the design did not mention
  and which `ss` does for the same reason: without it `2001:db8::1:51000` cannot
  be split back into an address and a port.
- The footnote truncates through `cell()` with the theme's ellipsis rather than
  ink's `wrap="truncate-end"`, which appends U+2026 regardless of what the
  terminal can draw. `ContainerPanel`'s footnote still has this bug; it is
  reachable at narrow widths in ascii mode.
