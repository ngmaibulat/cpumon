# Phase 04 — D-Bus and systemd units

> **Status: shipped** in `@aibulat/etop` 0.5.0 / `libsysmon` 0.8.0.
> The D-Bus client is at `packages/libsysmon/src/dbus/` and is ready for
> [phase 05](./05-wifi-iwd.md). Read "What actually happened" at the bottom
> before using it.

This is the largest single piece of the remaining work, and almost all of it is
part A. Write it once, use it twice.

---

## Part A — a minimal D-Bus client

### Why hand-rolled

The standing "native sources, never a subprocess" decision rules out
`systemctl -o json` and `busctl --json`. The alternative to writing this is
taking a dependency — and `libsysmon` currently has exactly one runtime
dependency (chalk, in the renderer that `index.ts` deliberately does not
re-export). Every published D-Bus binding for Node is either unmaintained, has a
native build step, or pulls in a tree far larger than the two method calls
actually needed here.

So: a client that does the minimum, in `libsysmon`, with no dependency. The
scope is deliberately tiny — **connect, authenticate, call a method, unmarshal
the reply**. No signals, no properties-changed subscriptions, no server side, no
introspection. Both screens poll; neither needs to be pushed to.

Reassess if this grows past roughly 600 lines. That would mean the scope crept.

### What it must do

```
1. connect         AF_UNIX to $DBUS_SYSTEM_BUS_ADDRESS, defaulting to
                   unix:path=/run/dbus/system_bus_socket
2. auth            send a NUL byte, then the EXTERNAL handshake:
                     AUTH EXTERNAL <uid-as-ascii-hex>
                     NEGOTIATE_UNIX_FD   (skip: no fds are passed)
                     BEGIN
3. hello           org.freedesktop.DBus.Hello to get a unique name
4. call            METHOD_CALL, await the METHOD_RETURN or ERROR with the
                   matching reply serial
5. unmarshal       the reply body, against the signature in its header
```

Confirmed present on this machine: `/run/dbus/system_bus_socket` exists, mode
`srw-rw-rw-`, and `DBUS_SYSTEM_BUS_ADDRESS` is unset — so the default path is the
path that matters, and the env var is the override rather than the other way
round.

### The wire format, and the parts that bite

Little-endian (`'l'`, 0x6C) on x86; the client must still *read* the endianness
byte from replies rather than assuming, because the field is there precisely
because it varies.

**Alignment is the whole format.** Every type has an alignment and is padded to
it *from the start of the message body*, not from the start of the field:

| type code | meaning | align |
| --- | --- | --- |
| `y` | byte | 1 |
| `b` | boolean (a 32-bit 0 or 1) | 4 |
| `n` `q` | int16, uint16 | 2 |
| `i` `u` | int32, uint32 | 4 |
| `x` `t` | int64, uint64 | 8 |
| `d` | double | 8 |
| `s` `o` | string, object path — uint32 length, bytes, trailing NUL | 4 |
| `g` | signature — **byte** length, bytes, trailing NUL | 1 |
| `a` | array — uint32 byte length, then padding to the element's alignment | 4 |
| `(...)` | struct | 8 |
| `v` | variant — a signature, then one value of it | 1 |
| `{kv}` | dict entry, only inside an array | 8 |

Two of these are where a hand-rolled unmarshaller usually goes wrong:

- **An array's length is in bytes, not elements**, and the padding to the element
  alignment comes *after* the length and is *not* counted in it. An `a(sv)`
  whose length says 96 is 96 bytes of content after alignment, and the reader
  must stop by offset rather than by count.
- **A signature's length is one byte, not four.** It is the only length in the
  format that is not a uint32, and treating it as one shifts everything after it.

The header is `yyyyuua(yv)`: endianness, message type, flags, protocol version,
body length, serial, then an array of header fields. **The header array is padded
to an 8-byte boundary before the body begins**, which is the third classic
off-by-N. Field code 8 carries the body signature; field 5 the reply serial.

### `packages/libsysmon/src/dbus/` (new)

```
dbus/
  address.ts     parse DBUS_SYSTEM_BUS_ADDRESS; default to the system socket
  marshal.ts     pure: value + signature -> Buffer
  unmarshal.ts   pure: Buffer + signature -> value, plus bytes consumed
  message.ts     pure: header encode/decode
  client.ts      the only file that touches a socket
```

Four of the five files are pure functions over buffers, which is the point: they
are testable as a table of values on any platform, with no bus and no daemon.
`client.ts` is thin and is the only thing that needs a Linux box with dbus
running to exercise for real.

```ts
export type DBusValue = number | bigint | string | boolean | DBusValue[] | { [k: string]: DBusValue };

export function marshal(signature: string, value: DBusValue[], endianness?: 'l' | 'B'): Buffer;
export function unmarshal(signature: string, buffer: Buffer, offset?: number, endianness?: 'l' | 'B'):
    { value: DBusValue[]; offset: number };

export class DBusClient
{
    static connect(options?: { address?: string; timeoutMs?: number }): Promise<DBusClient>;
    call(m: { destination: string; path: string; iface: string; member: string;
              signature?: string; body?: DBusValue[] }): Promise<DBusValue[]>;
    close(): void;
}
```

`DBusClient` is **not** exported from `libsysmon`'s public `index.ts`. It is
internal plumbing for two collectors, not a general-purpose binding, and
publishing it means promising a stability nobody asked for. A `./dbus` subpath
export can be added later if a real consumer appears.

### Connection lifetime

One connection, opened on first use, held for the life of the poller, closed on
dispose. Not one per poll — the auth handshake is several round trips and doing
it every three seconds is pure waste.

But a held socket can die: `dbus-daemon` restarts, the connection is dropped
mid-poll. The client reconnects once on a dead socket and reports
`Unavailable('not-found')` if that also fails; it does not retry in a loop
inside a single poll, because the poller will come round again in three seconds
anyway.

---

## Part B — the systemd collector

### The source

`org.freedesktop.systemd1`, object `/org/freedesktop/systemd1`, interface
`org.freedesktop.systemd1.Manager`, method `ListUnits`. Signature
`a(ssssssouso)` — an array of ten-field structs.

Confirmed on this machine: **475 units**, arity 10, no arguments needed. A real
row:

```json
["docker-2fc4710d…scope",
 "libcontainer container 2fc4710d…",
 "loaded", "active", "running",
 "",
 "/org/freedesktop/systemd1/unit/docker_2d2fc4710d…_2escope",
 0, "", "/"]
```

The ten fields in order:

| # | field | example |
| --- | --- | --- |
| 0 | name | `sshd.service` |
| 1 | description | `OpenSSH Daemon` |
| 2 | loadState | `loaded`, `not-found`, `masked` |
| 3 | activeState | `active`, `inactive`, `failed`, `activating` |
| 4 | subState | `running`, `exited`, `dead`, `plugged` |
| 5 | followedBy | usually `""` |
| 6 | objectPath | the unit's own D-Bus path |
| 7 | jobId | `0` when no job is queued |
| 8 | jobType | `""`, `start`, `stop` |
| 9 | jobPath | `/` when none |

`ListUnits` returns **loaded** units only. `ListUnitFiles` would add the
installed-but-not-loaded ones; that is a second call and a different question,
and the screen should not silently mix the two. Start with `ListUnits` and say
"loaded units" in the subtitle.

### `packages/libsysmon/src/collectors/systemd.ts` (new)

```ts
export type UnitActiveState = 'active' | 'reloading' | 'inactive' | 'failed' | 'activating' | 'deactivating';

export type SystemdUnit = {
    name: string;
    description: string;
    loadState: string;
    activeState: UnitActiveState | string;
    subState: string;
    /** the suffix: service, socket, timer, mount, scope, slice, ... */
    type: string;
    jobType?: string;
};

/** pure: the unmarshalled a(ssssssouso) in, rows out */
export function parseListUnits(rows: DBusValue[][]): SystemdUnit[];

export async function getSystemdUnits(options?: SystemdOptions): Promise<Probe<{ units: SystemdUnit[] }>>;

export type SystemdOptions = { address?: string; timeoutMs?: number };
```

Failure mapping:

| condition | probe |
| --- | --- |
| not Linux | `unsupported-platform` |
| no bus socket | `not-found` — this machine does not run systemd |
| auth rejected | `permission-denied` |
| method returns a D-Bus error | `parse-error` with the error name |

Reading unit state needs no privilege — the polkit rules apply to *starting* and
*stopping*, which this screen does not do.

### `packages/etop/src/panels/UnitPanel.tsx` (new)

475 rows is a lot, and most of them are `.device` and `.mount` units nobody
opened this screen for. So the panel defaults to a filter rather than to
everything:

- Default view: `.service`, `.socket` and `.timer` units.
- `a` toggles "all types", and the subtitle says which is in force.
- Anything `failed` sorts to the top and is coloured with `theme.danger`,
  because a units screen exists mostly to answer "what is broken".

Columns: `UNIT`, `LOAD`, `ACTIVE`, `SUB`, `DESCRIPTION` (flex). `/` filters by
name and description, reusing the existing filter machinery — which currently
sets `focus: 'process'` in the `filter-open` reducer case and will need that
line generalised to the active panel.

That `filter-open` hardcoding is a small piece of phase-01 debt this phase pays
off.

## Registration

- `PanelId` gains `'unit'`; `SCREEN_PANEL.units = 'unit'`; `'unit'` joins
  `LIST_PANELS`; `PANEL_ORDER` untouched.
- `SOURCES_FOR.units = ['units']`.
- Delete `PENDING.units`.

## Tests

`packages/libsysmon/test/dbus.test.js` — the highest-value tests in the phase,
and all of them pure:

- Round-trip `marshal` → `unmarshal` for every type code in the table above.
- Alignment: a `(yu)` struct is 8 bytes with 3 of padding, not 5.
- An array length in bytes, with the element padding excluded from it.
- A signature's one-byte length, next to a string's four-byte one.
- A header decoded from a captured real reply — capture once with a socket
  script, commit the buffer as hex.
- Big-endian decode, driven from a hand-built buffer, since x86 will never
  produce one.

`packages/libsysmon/test/systemd.test.js`:

- `parseListUnits` on the ten-field rows above, including the `.scope` name with
  escaped hex in it.
- Type extracted from the suffix, including a name with dots in it
  (`dev-disk-by\x2did-….device`).
- Failure mappings via a fake address pointing at nothing.

Gate any live-bus test with `{ skip: process.platform !== 'linux' }`, as
`test/system.test.js` already does.

## Effort

Large — the client is most of it. Budget it as its own sitting, with the
marshalling tests written alongside rather than after; a hand-rolled binary
format with tests written last is a format that agrees with its own bugs.


## What actually happened

The client worked against the real system bus on its first run: 475 units,
arity 10, in about 10 ms including connect, authenticate and Hello. The wire
format notes in this document were accurate and are worth trusting for phase 05.

### For phase 05: what the client gives you

```ts
import { DBusClient } from '../dbus/client.js';

const client = await DBusClient.connect({ address, timeoutMs });
const reply = await client.call({ destination, path, iface, member, signature, body });
client.close();
```

`reply` is the unmarshalled body as a plain array. Variants come back as their
inner value and `a{sv}` comes back as an object, so an iwd property bag reads as
`{ Name: 'home-wifi', Strength: -55 }` with no unwrapping. Marshalling a variant
needs its signature stated - `new Variant('s', 'x')` - and that asymmetry is
deliberate.

A connection per call, not a held one. Measured, the whole handshake costs about
10 ms against a poll every three seconds, and a cached client would need
invalidation on every way a socket can die.

### The size tripwire fired, and the answer is to keep it

This document said to reassess past roughly 600 lines. The directory is **1486
lines, 937 of them code**. So: reassessed.

The scope did *not* creep - there are still no signals, no property
subscriptions, no server side and no introspection, exactly as specified. The
overage is in `marshal.ts` and `unmarshal.ts`, 426 code lines between them,
which is what a complete type system costs in both directions: fourteen type
codes, each with an alignment, plus arrays, structs, dict entries and variants.
That is the format, not scope. `client.ts` is 229 code lines against its own
budget of 300.

The judgement stands: no runtime dependency, and 33 pure tests over a table of
values plus a captured real reply stream. The 600 figure was simply too low for
what "unmarshal the reply" means.

### Classifying failures from errno does not work under bun

The same lesson phase 03 learned about the docker socket applies here, so both
now share `collectors/socket.ts`: stat the path, then check access, and only
then connect. Bun's `node:net` reports every connect failure as one opaque error
with no errno, so a collector reading the connect error gives a different answer
depending on the runtime.

Bun also surfaces a bad socket path *before* the caller can attach an `error`
listener, where node emits it on a later tick. An unhandled `error` event is a
thrown exception, so the "no such socket" case escaped as a crash rather than an
Unavailable. `open()` now builds the socket, attaches listeners, and connects
last.

### A bug from phase 03, found by this phase

`STACK_BINDINGS` was declared, exported and rendered into the help overlay - and
never spread into `PANEL_BINDINGS`, which is the array `resolve()` reads. So
`Enter` on the stacks screen did nothing at all in 0.4.0, while the help
confidently listed it.

Phase 03's tests dispatched `{ type: 'toggle-collapse' }` to the reducer
directly and never went through `resolve()`, which is exactly why they passed.
`test/keymap.test.js` now asserts that every declared binding table is reachable
from `ALL_BINDINGS`, and that the help overlay documents all of them and nothing
else. **Phase 05 must add its bindings to `PANEL_BINDINGS`, not just declare
them** - and the test will now say so if it forgets.

### The phase-01 filter debt is paid

`filter-open` no longer hardcodes `focus: 'process'`; it uses
`SCREEN_PANEL[state.screen] ?? state.focus`, so opening the filter on a
full-screen list focuses that list and the dashboard is left alone.
