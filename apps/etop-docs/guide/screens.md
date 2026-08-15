# Screens

etop has two axes. **Screens** are whole views, walked with `Tab` and
`Shift-Tab`. **Panels** are the tiles inside the dashboard screen, addressed
with `1`…`6` or cycled with `w` / `W`.

The strip under the header is the tab bar. The screen you are on is
highlighted; a `‹` or `›` at either end means the terminal is too narrow to show
every tab at once, not that a screen is missing.

```
etop 0.6.0 · srv-01 · Linux 6.18.32-1-lts · up 7d · 1.0s
 dash   proc  units  cont  stacks  conn  wifi          Tab ▸ screen
╭─ CPU ─────────────────────╮╭─ MEM ─────────────────────╮
```

`Esc` is the way back. It closes whatever is most "on top" — an overlay, then a
filter, then a maximised panel — and once there is nothing left to close, it
returns you to the dashboard.

## dash

The tiled dashboard: cpu and memory across the top, network and disk in the
middle, processes and containers filling what is left. Panels this machine has
no concept of are dropped rather than drawn empty, and the rest reflow into the
space. See [Using the dashboard](./panels).

This is the only screen where panel focus means anything, so `1`…`6`, `w` / `W`
and `f` are all dashboard-only.

## proc

The process table, full height. Every process key works here exactly as it does
in the dashboard tile — sorting, `/` to filter, `Enter` to expand a row, `K` to
send a signal — because it is the same panel, given the whole frame.

Worth the screen when you are actually reading the list rather than watching it:
a forty-row table on a full screen shows the tail of what a ten-row tile cuts
off.

## containers

Container cgroups, full height and scrollable. Same caveat as the tile: if etop
is itself running inside a container, `/sys/fs/cgroup` *is* your own cgroup and
every other container is invisible. The panel says so rather than presenting an
empty list as "no containers".

Where docker is reachable, each row is joined against the engine's own list on
the container id, so the `CONTAINER` column shows the name rather than twelve
hex digits and an `IMAGE` column appears beside it. A container docker does not
know about — podman, lxc, or docker simply not running — keeps its short id
rather than going blank.

The numbers still come from cgroups, not from docker. `/containers/<id>/stats`
is a streaming endpoint with its own sampling model, and using it would put two
different definitions of `%CPU` on one screen. Docker supplies identity; cgroups
supply figures.

## conn

Every TCP and UDP socket the kernel will show you, from `/proc/net/tcp`,
`tcp6`, `udp` and `udp6`. Listeners sort to the top, then by local port, because
"what is listening on this box?" is the question people open this screen with.

IPv6 addresses are bracketed before their port — `[::]:443`, the same way `ss`
writes them — so the port cannot be misread as one more address group.

The `PROCESS` column has three states, and the difference between two of them
matters:

| Cell | Meaning |
| --- | --- |
| a name | that process holds the socket |
| `-` | nothing holds it — a `TIME_WAIT` remnant, say |
| `?` | something holds it and you are not allowed to see what |

Finding the owner means reading `/proc/<pid>/fd` for every process, and as an
ordinary user most of those are denied — on a normal desktop, roughly two thirds.
So `?` is common, and collapsing it into `-` would quietly claim a socket is
ownerless when it is merely private. A footnote appears whenever any row is `?`.
Running as root fills them in.

The scan costs about fifty milliseconds and runs once per refresh, only while
this screen is open.

## stacks

Docker compose projects, their folders and their services. A project row shows
how many of its services are up and where the project lives on disk; the rows
indented under it are the services themselves.

```
STACKS 3 projects · 20 services
PROJECT / SERVICE  STATE    IMAGE                       STATUS
↓ default-lab      13/13 up …/siem-tracker/containers/default
  nginx            running  nginx:alpine                Up 19 hours
  postgres         running  postgres:18                 Up 19 hours (healthy)
↓ mailgw           0/6 up   …/projects/mailgw/mailgw
  mailhog          exited   mailhog/mailhog             Exited (2) 4 days ago
```

`Enter` folds a project away and unfolds it again — six stacks of ten services
is sixty rows of which the interesting six are the headers. A folded project
keeps its counts, so nothing you were watching disappears with it.

Two things this screen deliberately does not show:

- **A container you started by hand with `docker run` is not here.** It has no
  compose project, and calling it a stack of one would be inventing something.
  It is on the [containers](#containers) screen.
- **A `docker compose run` container is marked `(run)` and left out of the
  counts.** Counted as a service, a shell somebody left open would make a
  healthy stack read `11/14 up` for as long as it ran.

The folder is shown from its tail, because that is the part that identifies it —
a column of `/home/admin/Downloads/2026-06-…` reads identically for every stack
on the machine.

::: info Compose is a label convention
There is no compose daemon and no compose API. A stack is a set of containers
that agree on a `com.docker.compose.project` label, and the folder is another
label beside it. etop groups on those labels; it does not shell out to
`docker compose`.
:::

## units

systemd units, read from the system bus. Anything `failed` sorts to the top and
is coloured, because a units screen mostly exists to answer "what is broken".
Everything else stays alphabetical, which is what makes a unit findable by eye.

```
UNITS 204 loaded · service/socket/timer · 5 failed
UNIT                     LOAD      ACTIVE   SUB     DESCRIPTION
aidecheck.service        loaded    failed   failed  Aide Check
logid.service            loaded    failed   failed  Logitech Configuration Daemon
accounts-daemon.service  loaded    active   running Accounts Service
apparmor.service         not-found inactive dead    apparmor.service
```

**The list is filtered by default**, and the subtitle says so. A real machine
has around 475 loaded units and well over a third of them are `.device` and
`.mount` entries udev created for every disk, partition and hidraw node on the
box. So the default is `.service`, `.socket` and `.timer`; `a` turns the rest
on and the subtitle changes to `all types`.

A **failed unit is never hidden by that filter**, whatever its type. A machine
whose only broken thing is a `.mount` would otherwise show a clean screen while
being broken.

`/` filters by name and description together.

These are **loaded** units — what `ListUnits` returns. Units that are installed
but not loaded would need a second call answering a different question, and
mixing the two would make the count mean nothing.

Reading unit state needs no privilege. The polkit rules on systemd cover
*starting* and *stopping* units, which this screen does not do.

## wifi

The network you are on at the top, everything the last scan saw below it.

```
WIFI wlan0
HOMENET_5G [█████████████████████████▍          ]  -57 dBm
ch 112 · 5560 MHz · 802.11ax · rx 907.4 / tx 720.6 Mbit/s · up 3h 6m

NETWORK                 SEC     SIGNAL
HOMENET_5G              psk    -56 dBm ✓ connected
HOMENET                 psk    -58 dBm known
NEIGHBOUR_2G            psk    -59 dBm
GUEST_OPEN              open   -66 dBm
```

**The signal bar is an absolute scale**, -30 dBm full to -90 dBm empty, not a
scale relative to the strongest network in view. A relative bar would draw the
best of three terrible signals at full strength, which is the opposite of what a
signal meter is for.

The detail line drops fields from the right as the terminal narrows, keeping
channel and frequency longest.

`known` marks a network you have joined before. It is shown only where iwd
actually still holds the saved profile, so a network you have just forgotten
stops being marked immediately rather than at the next scan.

### Without iwd

etop reads wifi from [iwd](https://iwd.wiki.kernel.org/) over the system bus.
When iwd is not reachable — most machines run `wpa_supplicant` or
NetworkManager instead — it falls back to `/proc/net/wireless`, which is a
plain file needing no daemon at all.

That fallback has a signal level and nothing else: no SSID, no security, no
scan. The header says `proc` and the screen says so in as many words. A machine
with no wireless interface at all is `not applicable` and the screen is dropped
rather than drawn empty.

### Connecting is out of scope

etop does not connect to, disconnect from, or forget networks. iwd exposes all
three as single method calls, but a connection that needs a passphrase needs a
credentials agent, which means running a D-Bus service and putting a passphrase
prompt in a dashboard. That deserves its own design and a flag of its own, the
way `--allow-kill` gates signalling processes.

They are listed in the tab bar rather than hidden until they work, because the
alternative is a tab bar whose shape changes between machines depending on what
happens to be installed.

## Terminal size

The frame spends three rows on itself — header, tab bar, footer — so the
smallest terminal etop will draw in is 40 × 11. Below that it says so and
draws nothing, which is the honest answer; see
[Terminals and platforms](./terminals).
