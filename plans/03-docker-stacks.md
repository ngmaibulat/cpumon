# Phase 03 — Docker and compose stacks

> **Status: shipped** in `@aibulat/etop` 0.4.0 / `libsysmon` 0.7.0.
> The asynchronous sampling path exists; phases 04 and 05 plug into it by adding
> one entry to `SlowSource` and one to `SOURCES_FOR`. See the bottom of this file
> for what to know before you do.

Two parts. Part A is infrastructure with no user-visible result; part B is the
screen. They land together because building an async sampling path with no
consumer is how you get one with the wrong shape.

---

## Part A — the asynchronous sampling path

### The problem

`SystemMonitor.measure()` is synchronous, and deliberately so. From
`collectors/proc.ts`:

> /proc and /sys are memory-backed... Going async would force every renderer to
> become async for no measurable gain, and would introduce overlapping ticks
> when a sample outlives its interval.

That reasoning is correct and should not be revisited. But docker, systemd and
iwd are all sockets, and a socket round-trip is not a memory-backed file read.
Blocking the render loop on one would make the dashboard stutter whenever the
docker daemon is busy.

### The decision

`SystemMonitor` is not touched. `libsysmon` exports the new collectors as
`async function getX(): Promise<Probe<...>>`, and **`etop` owns a second, slower
poller**.

This is the right split rather than a compromise:

- The things it polls — container lists, unit lists, compose projects, known
  wifi networks — change on the scale of seconds, not milliseconds. Sampling
  them at the CPU graph's rate would be waste, not fidelity.
- `libsysmon` stays a library of collectors. The scheduling policy belongs to
  the application that knows which screen is showing.
- `SystemMonitor` remains the cheap synchronous path for the `cpumon` CLI and
  every other consumer, with its documented contract intact.

### `packages/etop/src/state/slow.ts` (new)

```ts
export type SlowState = {
    docker?: Probe<{ containers: DockerContainer[] }>;
    units?: Probe<{ units: SystemdUnit[] }>;      // phase 04
    wifi?: Probe<WifiState>;                       // phase 05
    /** monotonic; a memo key, same role as StoreState.ticks */
    ticks: number;
};

export type SlowSource = 'docker' | 'units' | 'wifi';

export class SlowPoller
{
    constructor(options: { intervalMs?: number });   // default 3000
    getSnapshot(): SlowState;
    subscribe(listener: () => void): () => void;
    /** only sources some visible screen has asked for are polled */
    setActive(sources: SlowSource[]): void;
    dispose(): void;
}
```

Five properties it must have, four of which are lessons `SnapshotStore` already
paid for and one that is new to async:

1. **`getSnapshot()` returns the cached object.** Building a fresh one per call
   makes `useSyncExternalStore` re-render forever and the app spins at 100% CPU
   without drawing a second frame. This is the single most common way to hang an
   ink app and it looks exactly like a slow renderer. See the comment on
   `SnapshotStore.getSnapshot`.
2. **Constructed before `render()`**, like `SnapshotStore`, and disposed by the
   same `installLifecycle` path.
3. **No overlapping ticks.** A poll that outlives its interval must not have a
   second one started underneath it. Use a `setTimeout` chain that reschedules on
   settle, not `setInterval` — this is the specific failure the sync design was
   avoiding, and it arrives here instead.
4. **A rejected poll publishes an `Unavailable`, it never throws.** An unhandled
   rejection takes the process down with the alternate screen still up.
5. **`setActive` is what keeps this free.** A dashboard that never opens the
   `stacks` screen should never open the docker socket. Screens declare what
   they need; the poller polls the union.

`unref` every timer, so nothing here holds the event loop open behind ink.

### Wiring

A `SlowProvider` context next to `StoreProvider` in `src/index.ts`, a
`useSlowState()` hook next to `useStoreState()`, and one effect in `App` calling
`slow.setActive(SOURCES_FOR[ui.screen] ?? [])`.

---

## Part B — the docker collector and the two screens

### The source

The Docker Engine API over `/var/run/docker.sock`, which speaks plain HTTP. Node
reaches it with no dependency at all:

```ts
http.request({ socketPath: '/var/run/docker.sock', path: '/v1.43/containers/json?all=1', method: 'GET' })
```

Confirmed on this machine — 13 containers, and every top-level field the
`containers` screen is currently missing:

```
top-level keys: Command, Created, HostConfig, Id, Image, ImageID, Labels,
                Mounts, Names, NetworkSettings, Ports, State, Status
```

### Compose is a label convention, and that is all it is

There is no compose daemon and no compose API. A "stack" is a set of containers
that agree on one label. Confirmed, from a real container here:

```json
"com.docker.compose.project":              "default-lab",
"com.docker.compose.project.working_dir":  "/home/admin/Downloads/2026-06-26/siem-tracker/containers/default",
"com.docker.compose.project.config_files": "/home/admin/.../containers/default/docker-compose.yml",
"com.docker.compose.service":              "nginx",
"com.docker.compose.container-number":     "1",
"com.docker.compose.oneoff":               "False"
```

`working_dir` is the folder. `service` is the element. A `group by` on `project`
is the entire stack model — which is why this screen is cheap despite looking
like the most ambitious one on the list.

Grouped, this machine has one project with thirteen services:

```
default-lab  ← /home/admin/Downloads/2026-06-26/siem-tracker/containers/default
  nginx  studio-control  studio-domain  scheduler  app  mariadb-slave2
  mariadb-slave1  postgres  minio  mariadb-master  meilisearch  squid  redis
```

Two honesty constraints follow from labels being the only source:

- A container started by hand with `docker run` has no project label. It is not
  a one-service stack; it belongs in `containers` and not in `stacks`. Group it
  under no project and leave it out.
- `oneoff: "True"` marks a `docker compose run` container. Showing it as a
  service of the stack overstates what the stack is; mark it or omit it, but do
  not silently count it.

### `packages/libsysmon/src/collectors/docker.ts` (new)

```ts
export type DockerContainer = {
    id: string;                    // full 64-hex; the panel shortens with format.shortId
    name: string;                  // Names[0] with its leading slash stripped
    image: string;
    command: string;
    createdAt: number;             // seconds since epoch, as the API gives it
    state: string;                 // 'running' | 'exited' | 'paused' | ...
    status: string;                // 'Up 3 days', the human string
    ports: DockerPort[];
    labels: Record<string, string>;
    compose?: ComposeMembership;   // absent when the container is not part of a project
};

export type ComposeMembership = {
    project: string;
    service: string;
    containerNumber: number;
    workingDir?: string;
    configFiles?: string[];
    oneoff: boolean;
};

export type ComposeStack = {
    project: string;
    workingDir?: string;
    configFiles: string[];
    services: DockerContainer[];
    /** counts, so the row can say "11/13 up" without the panel recomputing it */
    running: number;
    total: number;
};

/** pure: the parsed JSON body in, rows out */
export function parseDockerContainers(body: unknown): DockerContainer[];

/** pure: the grouping that is the whole stack model */
export function groupIntoStacks(containers: DockerContainer[]): ComposeStack[];

export async function getDockerContainers(options?: DockerOptions): Promise<Probe<{ containers: DockerContainer[] }>>;

export type DockerOptions = { socketPath?: string; apiVersion?: string; timeoutMs?: number };
```

Same reader/parser split as everywhere else: `parseDockerContainers` and
`groupIntoStacks` are pure and exported, so the tests run against a recorded JSON
fixture on a machine with no docker.

Failure mapping, and it matters that these stay distinct:

| condition | probe |
| --- | --- |
| socket does not exist | `not-found` — docker is not installed |
| `EACCES` on connect | `permission-denied` — installed, user not in the `docker` group |
| connect times out | `not-found` with a detail — installed, daemon not running |
| non-2xx or unparseable body | `parse-error` with the status |
| not Linux | `unsupported-platform` |

The `permission-denied` case is the common one on a fresh machine and is exactly
the actionable failure `Unavailable` exists for. Do not collapse it into
"docker unavailable".

### `packages/etop/src/panels/StackPanel.tsx` (new)

The screen the user asked for: folders and their elements. A flat list with the
project rows expanded into their services, rather than a tree — `Table` draws one
pre-built line per row and that is not negotiable for the same Yoga-node reason
`Table.tsx` documents.

```
STACKS 1 project · 13 services
PROJECT / SERVICE        STATE      IMAGE                   STATUS
default-lab              11/13 up   /home/admin/Downloads/…/containers/default
  nginx                  running    nginx:alpine            Up 3 days
  postgres               running    postgres:16             Up 3 days
  scheduler              exited     default-lab-scheduler   Exited (0) 2 hours ago
```

The project row carries the folder; the indented rows carry the services. `Enter`
collapses and expands a project — reuse `ui.expanded`'s shape but keyed by
project, since a machine with six stacks of ten services each is otherwise sixty
rows of which the interesting six are the headers.

### `ContainerPanel`, enriched

The cgroup collector gives an id, a runtime and resource figures — no name, no
image, no status. That is why the current screen shows twelve hex digits.

Join on the container id: the cgroup path `docker-<64hex>.scope` contains exactly
the id the docker API returns. Where the join succeeds, show the name and image;
where it fails — podman, lxc, a cgroup with no docker record — keep the current
columns and do not blank them.

**The cgroup collector stays the source of truth for CPU and memory.** It is
per-window, matches the process table's scale, and needs no daemon. Docker's
`/containers/<id>/stats` is a streaming endpoint with its own sampling model and
adopting it would mean two different definitions of "%CPU" on one screen. Docker
supplies identity; cgroups supply numbers.

## Registration

- `PanelId` gains `'stack'`; `SCREEN_PANEL.stacks = 'stack'`; `'stack'` joins
  `LIST_PANELS`. **`PANEL_ORDER` is not touched** — see the note in phase 02.
- `SOURCES_FOR.stacks = ['docker']`, and `SOURCES_FOR.containers = ['docker']`
  too, since the enriched container screen now wants it.
- Delete `PENDING.stacks`.

## Tests

`packages/libsysmon/test/docker.test.js` against a recorded fixture — capture a
real body once with
`curl -s --unix-socket /var/run/docker.sock http://localhost/v1.43/containers/json?all=1`
and commit it trimmed:

- `groupIntoStacks` on containers from two projects plus one unlabelled →
  two stacks, the loose container in neither.
- A `oneoff` container is not counted in `running`/`total`.
- `workingDir` absent → the stack still forms, with no folder shown.
- Every failure mapping above, driven by a fake `socketPath`.

`packages/etop/test/stacks.test.js`:

- A project row shows its folder; a service row is indented under it.
- Collapsing a project hides its services and keeps its counts.
- `assertFits` and ascii-only, at several widths.

`packages/etop/test/slow.test.js`:

- `getSnapshot()` returns the identical object across calls with no publish.
- A poll that rejects publishes an `Unavailable` and does not throw.
- A poll slower than the interval does not start a second one.
- `setActive([])` stops polling entirely.

## Effort

Medium. The docker client is perhaps eighty lines of `node:http`; the grouping is
twenty; the `SlowPoller` is the part to get right, and phases 04 and 05 will be
much cheaper for it existing.


## What actually happened

### For phases 04 and 05: adding a slow source

Three edits and nothing else.

1. `state/slow.ts`: add the name to `SlowSource`, the probe to `SlowState`, and
   the call to `DEFAULT_FETCHERS`. The fetcher's only contract is that it
   returns a `Probe` and does not reject — and even a rejection is caught and
   published as an `Unavailable`, so a broken one degrades rather than kills.
2. `app.tsx`: add the screen to `SOURCES_FOR`.
3. Delete the screen's `PENDING` entry.

`Promise.allSettled` is what makes this safe to grow: sources poll concurrently
and one failing or hanging cannot cancel or delay another. That is already
tested, with only one source in existence, precisely so the second one arrives
into a contract rather than into an assumption.

### The failure mapping could not be read from the connect error

The design's table classified docker failures by errno — `ENOENT` for not
installed, `EACCES` for not in the group, and so on. Node reports exactly those.
**Bun does not**: its `node:http` shim collapses every connect failure into a
single `FailedToOpenSocket` with no errno at all, so the same machine in the
same state produced `not-found` under one runtime and `parse-error` under the
other. The whole point of keeping the three cases distinct was lost on half the
test matrix.

So `checkSocket()` stats the path before the request instead: missing, not a
socket, or not writable, each decided by `statSync`/`accessSync`, which behave
identically everywhere. The connect error is now only consulted for what is left
over — the socket is there and writable and still nothing answered — which is
the daemon, and is reported as such.

This is better than the original even on node, because it distinguishes "the
path exists but is not a socket" from "the daemon is down", which errno alone
could not.

### No platform guard

The design mapped non-Linux to `unsupported-platform`. Dropped: the docker
socket is not a kernel interface, Docker Desktop exposes the same path on macOS,
and a machine without docker already gets `not-found` from the stat. Claiming a
platform is unsupported when the socket is right there and answering would be a
false statement, and this package's collectors do not make those.

### Owner of the fold state

`Enter` on the stacks screen produces `{ type: 'toggle-collapse', project: '' }`
and `App` fills the project in from a ref the panel writes. That is the shape the
kill modal already uses to pin a pid, and for the same reason: the keymap is
pure and the reducer has no idea what a row is, so the only place that knows
what the cursor is standing on is the panel.

`UiState.collapsed` records what is *folded*, not what is open, so the default -
an empty object - shows everything. It is keyed by project name rather than row
index because the list is resampled every three seconds, and an index would fold
a different project the moment one appeared or exited.

### The counts and the one-off rule, confirmed against a real machine

Measured here: 20 containers, 3 projects, 0 unlabelled. The `oneoff` and
unlabelled cases therefore do not occur on this host and are covered by
synthesised rows in `test/fixtures/docker-containers.json` rather than by luck.

The cgroup ↔ docker join was checked against the live machine: 13 of 14 cgroups
matched a docker record, and the fourteenth is an lxc payload that correctly
matched nothing and kept its short id.

### Still open

`ContainerPanel`'s namespaced footnote truncates through ink's
`wrap="truncate-end"`, which appends U+2026 whatever the terminal can draw.
`ConnectionPanel` and this phase's panels avoid it by truncating through
`cell()` with the theme's ellipsis; that one was left alone, and is reachable at
narrow widths in ascii mode.
