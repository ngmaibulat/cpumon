# Phase 05 — Wifi

> **Status: shipped** in `@aibulat/etop` 0.6.0 / `libsysmon` 0.9.0.
> The last phase. Every screen now has a panel.

Last because it is cheapest once those two exist — and it would be the most
expensive if it went first, since it would have to build both.

## The source

`net.connman.iwd` on the system bus. Confirmed running on this machine:

```
net.connman.iwd    2342370  iwd  root  :1.12658  iwd.service
```

Note this, because an earlier draft got it wrong: **`/run/iwd` does not exist on
a machine where iwd is running perfectly well.** Probing for that directory as a
liveness check reports "not installed" for a working daemon. The correct check is
whether the bus name is reachable, which falls out of the D-Bus call failing with
`ServiceUnknown` — no separate probe needed.

This machine also runs `wpa_supplicant` alongside iwd, which is worth knowing
because it means "a wifi daemon is running" is not the same claim as "iwd is
managing your wifi".

## The object tree

One `GetManagedObjects` call on `/` gives the whole thing. Confirmed shape here:

```
net.connman.iwd.Adapter            x1
net.connman.iwd.Device             x1
net.connman.iwd.Station            x1
net.connman.iwd.StationDiagnostic  x1
net.connman.iwd.Network            x12
net.connman.iwd.KnownNetwork       x19
net.connman.iwd.BasicServiceSet    x12
```

The interfaces that matter, with real values:

**`Adapter`** — the hardware.
```json
{"Powered": true, "Model": "MT7921 802.11ax PCIe Wireless Network Adapter [Filogic 330]",
 "Vendor": "MEDIATEK Corp.", "Name": "phy0", "SupportedModes": ["station", "ap"]}
```

**`Device`** — the interface. `Name` is the `wlan0` that the network panel also
knows about, which is the join between the two screens.
```json
{"Name": "wlan0", "Address": "cc:5e:f8:f1:30:bd", "Powered": true, "Mode": "station"}
```

**`Station`** — what it is doing.
```json
{"State": "connected",
 "ConnectedNetwork": "/net/connman/iwd/0/6193/54435044554d505f3547_psk",
 "Scanning": false}
```

**`Network`** — one per visible SSID. `Name` is the human SSID; the path segment
is the SSID hex-encoded with the security suffix, which is why paths are
unreadable and `Name` is what you display.
```json
{"Name": "TCPDUMP_5G", "Connected": true, "Type": "psk",
 "KnownNetwork": "/net/connman/iwd/54435044554d505f3547_psk"}
```

### Signal strength is not on `Network`

This is the one real trap. `Network` has no signal property. Two separate calls
supply it, and they answer different questions:

**`Station.GetOrderedNetworks()` → `a(on)`** — every visible network with its
signal in **hundredths of a dBm**:

```json
[["/net/connman/iwd/0/6193/54435044554d505f3547_psk", -5100],
 ["/net/connman/iwd/0/6193/4d5453526f757465725f32433231_psk", -5900],
 ["/net/connman/iwd/0/6193/54502d4c696e6b5f457874656e646572_open", -6300]]
```

`-5100` is **-51 dBm**. Divide by 100. Rendering the raw value as dBm produces a
signal reading two orders of magnitude wrong that still looks like a number, so
do the division in the collector and never let the raw units reach a panel.

The list is already ordered strongest-first, which is the order the screen wants.

**`StationDiagnostic.GetDiagnostics()` → `a{sv}`** — much richer, connected
network only:

```json
{"ConnectedBss": "f0:2f:74:c7:db:0c", "Frequency": 5560, "Channel": 112,
 "Security": "WPA2-Personal", "RSSI": -56, "AverageRSSI": -55,
 "RxMode": "802.11ax", "TxMode": "802.11ax", "RxMCS": 10, "TxMCS": 7,
 "TxBitrate": 7206, "RxBitrate": 10806, "ConnectedTime": 112897}
```

Here `RSSI` is **plain dBm**, not hundredths. Two signal fields on one screen in
two different units is exactly the sort of thing that ships wrong, so the
collector normalises both to dBm and the type carries no raw values.

`Bitrate` is in units of 100 kbit/s — `7206` is 720.6 Mbit/s. Normalise that too.

### `/proc/net/wireless` as a fallback

```
Inter-| sta-|   Quality        |   Discarded packets               | Missed | WE
 face | tus | link level noise |  nwid  crypt   frag  retry   misc | beacon | 22
 wlan0: 0000   53.  -57.  -256        0      0      0      0      2        0
```

A synchronous file read that needs no daemon and no bus, giving link quality and
signal level for any wifi interface — including one managed by
`wpa_supplicant` or `NetworkManager` rather than iwd.

It is worth having as a **degraded mode**, not as the primary source: it has no
SSID, no security, no network list. When iwd is unreachable but this file has a
row, the screen shows the interface and its signal and says plainly that the
rest needs iwd. That is a much better answer than an empty screen on a machine
that plainly has working wifi.

It is also the only part of this phase that works on a `wpa_supplicant`-only
machine, which is most of them.

## `packages/libsysmon/src/collectors/wifi.ts` (new)

```ts
export type WifiSource = 'iwd' | 'proc';

export type WifiNetwork = {
    ssid: string;
    security: string;          // Network.Type: 'psk' | 'open' | '8021x' | ...
    connected: boolean;
    known: boolean;            // has a KnownNetwork object
    /** dBm, normalised; absent when this network was not in GetOrderedNetworks */
    signalDbm?: number;
};

export type WifiConnection = {
    ssid: string;
    bssid: string;
    frequencyMhz: number;
    channel: number;
    security: string;
    signalDbm: number;
    averageSignalDbm?: number;
    rxMode?: string;
    txMode?: string;
    rxBitrateMbps?: number;
    txBitrateMbps?: number;
    connectedSeconds?: number;
};

export type WifiDevice = {
    name: string;              // 'wlan0'
    address: string;
    powered: boolean;
    mode: string;              // 'station' | 'ap'
    adapterModel?: string;
    /** 'connected' | 'disconnected' | 'scanning' | ... */
    state: string;
    scanning: boolean;
};

export type WifiState = {
    source: WifiSource;
    devices: WifiDevice[];
    connection?: WifiConnection;
    networks: WifiNetwork[];
};

/** pure: the GetManagedObjects reply in, the tree out */
export function parseManagedObjects(objects: DBusValue): WifiState;

/** pure: /proc/net/wireless text in, the degraded state out */
export function parseProcWireless(text: string): WifiState;

export async function getWifi(options?: WifiOptions): Promise<Probe<WifiState>>;
```

`Probe<WifiState>` flattens rather than wrapping, because `WifiState` is an
object with no `available` field of its own and no top-level array — the two
conditions the `Probe` doc names. Its arrays are safely one level down.

Resolution order in `getWifi`: try iwd; on `ServiceUnknown` or a missing bus,
fall back to `/proc/net/wireless`; if that has no rows either, return
`not-found`. `source` says which one answered, and the panel shows it, because a
screen that silently degrades is a screen that lies about what it knows.

`not-applicable` when `/proc/net/wireless` exists but lists no interfaces — a
desktop with no wifi card is not a failure, and `useLayout.isAbsent` already
treats that reason as "this screen should not exist here".

## `packages/etop/src/panels/WifiPanel.tsx` (new)

Not a bare table — the connected network deserves the top of the screen and the
scan list the rest:

```
WIFI wlan0 · iwd
TCPDUMP_5G   WPA2-Personal   -56 dBm  [████████▍     ]
ch 112 · 5560 MHz · 802.11ax · rx 1080.6 / tx 720.6 Mbit/s · up 1d 7h

NETWORK                     SEC        SIGNAL
TCPDUMP_5G                  psk        -51 dBm   ✓ connected
TCPDUMP                     psk        -51 dBm   known
MTSRouter_2C21              psk        -59 dBm
TP-Link_Extender            open       -63 dBm
DIRECT-C7-HP Laser 179fnw   psk        -65 dBm
```

Reuse `ui/Gauge.tsx` for the signal bar, mapping dBm to a ratio over a fixed
range — **-30 dBm excellent to -90 dBm unusable** — rather than normalising
against the strongest network in the list. A relative scale would show the best
of three terrible signals as full strength.

The detail line drops fields right-to-left as the terminal narrows, the way
`Header` already does.

## Registration

- `PanelId` gains `'wifi'`; `SCREEN_PANEL.wifi = 'wifi'`.
- **Not** in `LIST_PANELS` unless the network list gets a cursor. It probably
  should — connecting to a network is a natural next step — but that is an
  action, not a view, and it is out of scope here. See below.
- `PANEL_ORDER` untouched.
- `SOURCES_FOR.wifi = ['wifi']`.
- Delete `PENDING.wifi` — the last entry, at which point `Placeholder.tsx` and
  its test can go too.

## Explicitly out of scope

**Connecting, disconnecting and forgetting networks.** iwd exposes
`Network.Connect()`, `Station.Disconnect()` and `KnownNetwork.Forget()`, and they
are one method call each with the client from phase 04.

They are left out because a connect that needs a passphrase needs an agent — iwd
calls back to a registered `net.connman.iwd.Agent` object for credentials, which
means the client grows a server side, and a passphrase prompt in a dashboard is
a security surface that deserves its own design rather than a paragraph at the
end of a phase.

If it is added later it belongs behind a flag, the way `--allow-kill` gates
signals: the same argument applies, and the same confirmation shape.

## Tests

`packages/libsysmon/test/wifi.test.js`, all pure, against a captured
`GetManagedObjects` reply committed as a fixture:

- The hundredths-of-a-dBm conversion. Assert `-5100` becomes `-51`, explicitly,
  because this is the bug most likely to ship.
- `RSSI` from diagnostics passes through unscaled — the two units next to each
  other in one test, so a future edit cannot make them agree wrongly.
- Bitrate `7206` → `720.6`.
- A network in `GetOrderedNetworks` but not in the object tree, and vice versa.
- `parseProcWireless` on the three-line sample above, and on a header-only file
  → `not-applicable`.
- `known` set only for networks with a `KnownNetwork` path.

`packages/etop/test/wifi.test.js`:

- The `source` is visible when it is `proc`, so a degraded screen says so.
- The signal gauge is absolute: a lone -85 dBm network does not draw full.
- `assertFits` and ascii-only at several widths — the `✓` needs an ascii
  fallback via `glyphs`.

## Effort

Small to medium, given phases 03 and 04. One `GetManagedObjects` call, two
follow-up calls, a unit conversion to be careful about, and a panel that is
mostly a `Gauge` and a `Table`.


## What actually happened

The cheapest phase, exactly as predicted, and for the predicted reason: the
`SlowPoller` took one new source and the D-Bus client took no changes at all.
Three method calls - `GetManagedObjects`, `GetOrderedNetworks`,
`GetDiagnostics` - and the whole thing answered in 9 ms.

Everything this document said about the source was correct, including the
warning about `/run/iwd`: it is still absent on this machine while iwd runs
perfectly, and `wpa_supplicant` is still running alongside it.

### The unit trap is real, and was captured live

From the same station at the same moment:

```
GetOrderedNetworks  ->  -5600     (hundredths of a dBm)
GetDiagnostics.RSSI ->  -55       (plain dBm)
```

Both conversions live in `collectors/wifi.ts` and are asserted in the same test,
deliberately adjacent, so a later edit cannot make them agree in the wrong
direction. No raw value reaches a panel.

### The fixture is anonymised, and that was not optional

A real `GetManagedObjects` reply is a scan of every wifi network within range,
with SSIDs and BSSIDs. That is location-identifying data about the machine's
owner and their neighbours, and this repository is published. The committed
fixture is structurally identical to the real reply - same interfaces, same
property names, same SSID-as-hex object paths - with synthesised names and MACs,
and it carries cases the real machine does not have: a scan entry whose network
object has vanished, and a network in the tree that the scan missed.

**Anything captured off a live machine needs this check before it is committed.**
The docker fixture in phase 03 was trimmed for size; this one was anonymised for
privacy, which is a different reason and a stricter one.

### `known` is a join, not a property

`Network.KnownNetwork` is a path, and the object it points at can be gone for a
moment after a Forget. `known` is true only where the path resolves to an object
actually present in the tree, so a network that has just been forgotten stops
being marked immediately.

Confirmed against the real machine: 19 KnownNetwork objects exist, 14 networks
are visible, and exactly one visible network carries a `KnownNetwork` property.
The other 18 saved networks are simply not in range - which is the correct
answer and not a broken join.

### Placeholder is gone

This was the last `PENDING` entry, so `panels/Placeholder.tsx` was deleted along
with it. `ScreenFor`'s default branch is now a `never` assertion: a screen added
to `ScreenId` without a case is a compile error rather than a blank frame at
runtime. `test/screens.test.js` asserts that every screen has a `SCREEN_PANEL`
entry, which is the same guarantee from the other side.

### Not in LIST_PANELS

As this document anticipated. The scan list has no cursor because the only thing
a cursor would be for is connecting, and connecting needs a credentials agent -
a D-Bus service and a passphrase prompt, which is a security surface deserving
its own design and its own flag. Left out, as specified.
