# Changelog

::: info The dashboard was renamed before its first release
It was developed as `cpumon-tui`, briefly carried the bare name `etop`, and is
published as [`@aibulat/etop`](https://www.npmjs.com/package/@aibulat/etop). The
command it installs is still `etop`. Nothing shipped under any of the earlier
names, so there is no migration to do.

The library it is built on was renamed at the same time, from `cpumon` to
[`libsysmon`](https://github.com/ngmaibulat/cpumon/tree/main/packages/libsysmon).
The command that library installs is still `cpumon`, which is why `etop` points
at `cpumon --json` when it cannot draw.
:::

## 0.7.0

**The `tunnels` screen**, and `etop tunnel` on the command line. SSH tunnels are
declared in `~/.config/etop/tunnels.json`, started and stopped from the screen,
and reconnected with a jittered exponential backoff when the link drops. `e`
opens the config in `$VISUAL` or `$EDITOR` and reloads it on the way back. See
[Screens](/guide/screens#tunnels) and [Keys](/guide/keys#tunnels).

The screen reports two things rather than one. `STATE` is what the supervisor
believes about the ssh process; `BOUND` is how many of the tunnel's local ports
actually have a listening socket, read from `/proc`. A tunnel showing `up` with
`1/2` — connection fine, one forward not bound — is the case a single merged
column would have hidden.

`etop tunnel up squid` supervises in the foreground and is a drop-in replacement
for an `ssh -L …` shell alias. `etop tunnel status` reports which of your ports
are bound and who holds them, and so sees tunnels started by anything, including
an alias still running in another pane. There is deliberately no `down`; the
reasoning is in [Screens](/guide/screens#there-is-no-down).

::: warning Your key must be in an agent
etop runs ssh with `BatchMode=yes`. A supervised tunnel has no terminal to type
a passphrase into, so without it a key with a passphrase would hang at an
invisible prompt instead of failing in a way the screen can report. Run
`ssh-add` first, or override it under `options`.
:::

This is the first release in which either package spawns a subprocess. It is
confined to `@aibulat/etop`; `libsysmon` is unchanged and is not republished.
The reasoning, and the three conditions that keep the exception narrow, are in
[plans/README.md](https://github.com/ngmaibulat/cpumon/blob/main/plans/README.md).

**Bug fix:** a tab-bar test asserted that `wifi` was the last screen, which
stopped being true when `tunnels` was added after it.

## 0.6.0

**The `wifi` screen**, and with it the last of the seven. The connected network
gets the top of the screen with an absolute signal gauge — -30 dBm full to -90
empty, never relative to the strongest network in view — and the scan list fills
the rest. See [Screens](/guide/screens#wifi).

Read from [iwd](https://iwd.wiki.kernel.org/) over the system bus, using the
D-Bus client added in 0.5.0. Where iwd is not reachable — most machines run
`wpa_supplicant` or NetworkManager — it falls back to `/proc/net/wireless`, and
says so: that source has a signal level and no SSID, security or scan at all, so
the screen names it rather than quietly showing less. A machine with no wireless
interface reports `not applicable` and the screen is dropped.

iwd reports signal strength in two different units on two calls that this screen
shows side by side — hundredths of a dBm from the scan, plain dBm from the
diagnostics. Both are normalised in the collector and no raw value reaches a
panel; the same goes for bitrates, which iwd counts in 100 kbit/s.

Connecting, disconnecting and forgetting networks are deliberately not here. A
connection that needs a passphrase needs a credentials agent, which means
running a D-Bus service and putting a passphrase prompt in a dashboard.

**Every screen now has a panel.** `Placeholder` — the component that told you
which collector a screen was waiting on — is gone, and `ScreenFor` ends in a
`never` assertion instead, so a screen added without a panel is a compile error
rather than a blank frame.

## 0.5.0

**The `units` screen.** systemd units over the system bus. Failed units sort to
the top and are coloured; everything else stays alphabetical. `a` switches
between the default `.service`/`.socket`/`.timer` view and every unit type, and
`/` filters by name and description. See [Screens](/guide/screens#units).

The default filter is not a cosmetic choice: a real machine has ~475 loaded
units and more than a third are `.device` and `.mount` entries udev created for
every disk and partition. A failed unit is shown whatever its type, so the
filter can never hide the thing the screen exists to surface.

**`libsysmon` 0.8.0 contains a D-Bus client.** No dependency, no subprocess: no
`systemctl`, no `busctl`. It connects to the system bus, authenticates with
EXTERNAL, calls a method and unmarshals the reply — and that is all it does.
No signals, no property subscriptions, no server side, no introspection, because
this screen polls and does not need to be pushed to. The marshaller is pure and
covered by 33 tests over a table of values, plus a real captured reply stream.

`getSystemdUnits` is exported from `libsysmon`; the client itself is not. It is
internal plumbing for a collector rather than a general-purpose binding, and
publishing it would promise a stability nobody has asked for.

::: warning Fixed: `Enter` did nothing on the stacks screen
The stacks key table was declared, exported, and listed in the help overlay, but
never spread into the array `resolve()` actually reads — so `Enter` on a compose
project silently did nothing in 0.4.0. Both key tables are now covered by a test
that asserts every declared binding is reachable and that the help overlay lists
all of them and nothing else.
:::

Also fixed: opening the filter with `/` set the focused panel to the process
table regardless of which screen you were on. It now focuses the panel actually
being filtered.

## 0.4.0

**The `stacks` screen.** Docker compose projects, their folders and their
services, read from the engine socket at `/var/run/docker.sock`. `Enter` folds a
project away and back. See [Screens](/guide/screens#stacks).

A container started by hand with `docker run` is not shown as a stack of one —
it has no compose project, and it stays on the containers screen. A
`docker compose run` container is marked `(run)` and left out of the counts,
because a shell somebody left open should not make a healthy stack read
`11/14 up`.

**The containers screen learned names.** Where docker is reachable, each cgroup
row is joined against the engine's list on the container id, so the `CONTAINER`
column shows the container's name instead of twelve hex digits and an `IMAGE`
column appears beside it. Anything docker does not know about — podman, lxc, or
docker not running — keeps its short id rather than going blank. The figures
still come from cgroups: docker's `/containers/<id>/stats` has a different
sampling model, and mixing them would put two definitions of `%CPU` on one
screen.

**A second, slower poller.** Sockets are not files. `SystemMonitor` stays
synchronous, sampling `/proc` and `/sys` on the render clock as it always has;
anything that means a round-trip to a daemon now runs on a separate three-second
poller that never blocks a frame. It polls only what the visible screen has
asked for, so a session that never opens `stacks` never opens the docker socket,
and leaving the screen stops the traffic. `libsysmon` 0.7.0 adds the async
`getDockerContainers`, with `parseDockerContainers` and `groupIntoStacks`
exported beside it.

Docker being unreachable is reported as three different things rather than one,
because they call for three different actions: not installed, not in the
`docker` group, and the daemon not running.

## 0.3.0

**The `conn` screen.** Every TCP and UDP socket the kernel will show you, read
from `/proc/net/{tcp,tcp6,udp,udp6}`. Listeners sort to the top, then by local
port. IPv6 addresses are bracketed before their port, `[::]:443`, so the port
cannot be read as one more address group. See [Screens](/guide/screens#conn).

The `PROCESS` column distinguishes three things rather than two. A name means
that process holds the socket; `-` means nothing does; `?` means something does
and this user may not see what. Owner lookup means reading `/proc/<pid>/fd` for
every process, and as an ordinary user most of those are denied — so `?` is the
common case, and reporting it as `-` would claim a socket is ownerless when it is
only private. A footnote says so whenever any row is `?`.

The scan costs roughly fifty milliseconds and runs once per refresh, only while
the screen is open. `libsysmon` 0.6.0 grows the `connections` collector behind
it — `getConnections`, `parseNetSockets` and `resolveOwners` — and a
`'connection'` entry in `CollectorName`, so a `SystemMonitor` consumer can ask
for sockets. The `cpumon` CLI has no socket view yet.

::: warning Fixed: table columns could sit under the wrong headers
When a terminal was too narrow for every column, the table dropped the
lowest-priority ones — but went on filling the surviving columns from the front
of each row, so every value after the gap was drawn one column to the left. A
container's `CPUS` figure appeared under `MEM`, and `MEM` under `LIMIT`. This
affected the process and container tables at narrow widths in 0.1.x and 0.2.0,
and there was nothing on screen to suggest it: each row was still the right
width and each cell still held a plausible number.
:::

## 0.2.0

**Screens.** The dashboard is now one view among several, walked with `Tab` and
`Shift-Tab` and shown as a tab bar under the header: `dash`, a full-height
`proc` table, scrollable `containers`, and placeholders for `units`, `stacks`,
`conn` and `wifi` naming the collectors they are waiting on. See
[Screens](/guide/screens).

::: warning Breaking: `Tab` changed meaning
`Tab` used to cycle panel focus within the dashboard. It now cycles screens.
Panel focus moved to `w` and `W`; the number keys `1`–`6` are unchanged but now
only act on the dashboard, since every other screen is a single view. `Esc`
gained a last rung: once there is nothing left to close, it returns to the
dashboard.
:::

The full-screen `proc` view is the same panel as the dashboard tile, given the
whole frame — every process key works there unchanged, because the keymap now
resolves panel bindings against the *active* panel rather than the focused one.
Cursor position is remembered per screen, so tabbing away and back does not send
you to the top of a four-thousand-row list.

The frame spends three rows on itself rather than two, so the minimum terminal
is 40 × 11. A terminal at exactly the minimum used to draw a header, a footer
and nothing between them; `computeLayout`'s own minimum was being compared
against body rows rather than terminal rows, and that is fixed.

Also: the container table scrolls and takes a cursor, and the process table
rounds its row request up to a multiple of 32, so moving that table between a
dashboard tile and a full screen no longer restarts the monitor and throws away
a sampling window.

## 0.1.0

**A full-screen dashboard**, in its own package. CPU with per-core detail,
memory and swap with a composition breakdown, filesystem usage, per-interface
network throughput, an interactive process table and container cgroups — all
from libsysmon's existing collectors, drawn with Ink.

It is separate on purpose. `libsysmon` stays a small library with one runtime
dependency; the dashboard is an application that brings React with it, and
nobody importing `SystemMonitor` should pay for that. See
[getting started](/guide/getting-started).

```sh
npx @aibulat/etop
```

Needs Node 22. `libsysmon` itself still supports Node 18.
