# Plans

Design documents for work that spans more than one sitting. One file per phase,
numbered in the order they should be built, because each one depends on the
infrastructure the one before it left behind.

These are not a changelog. A phase document says what is being built, what it is
built on, and — the part worth writing down — which of the obvious approaches
were rejected and why. Once a phase ships, its document stays and gets a status
line at the top; the user-facing account of what changed lives in
[`apps/etop-docs/changelog.md`](../apps/etop-docs/changelog.md).

| Phase | Screen | Status |
| --- | --- | --- |
| [01 — Screens](./01-screens.md) | the tab axis, `proc`, `containers` | **shipped** in `@aibulat/etop` 0.2.0 |
| [02 — Connections](./02-connections.md) | `conn` | **shipped** in `@aibulat/etop` 0.3.0 |
| [03 — Docker and compose stacks](./03-docker-stacks.md) | `stacks`, and a richer `containers` | **shipped** in `@aibulat/etop` 0.4.0 |
| [04 — D-Bus and systemd units](./04-dbus-systemd.md) | `units` | **shipped** in `@aibulat/etop` 0.5.0 |
| [05 — Wifi](./05-wifi-iwd.md) | `wifi` | **shipped** in `@aibulat/etop` 0.6.0 |
| [06 — SSH tunnels](./06-tunnels.md) | `tunnels` | **shipped** in `@aibulat/etop` 0.7.0 |

> **Phases 01–05 built the seven read-only screens.** Every one has a panel and
> `Placeholder` is gone. Phase 06 is the first that *acts* rather than reports,
> and it amends a standing decision to do it — see below. What follows is the
> record of why the order was what it was; each phase document ends with what
> actually happened when it was built.

## Why this order

Phase 02 needed nothing that did not already exist: `/proc/net/tcp` is a
synchronous file read, which is what every collector in `libsysmon` already is.
It shipped alone.

Phase 03 is where the **asynchronous sampling path** got built, because it was
the first phase that needed one. Phases 04 and 05 both depend on it, and it is
now there: `packages/etop/src/state/slow.ts`.

Phase 04 built a **minimal D-Bus client**, the largest single piece of the work.
It exists at `packages/libsysmon/src/dbus/`, and phase 05 used it as-is - three
method calls, no changes to the client at all, which is the evidence that
writing it once for two screens was the right call.

Reordering 04 before 03 would work but wastes the cheaper win: `stacks` is one
HTTP request to a unix socket and a `group by` on a label, and it is the screen
that answers a question nobody can currently answer from the dashboard at all.

## Standing decisions

These were settled once and apply to every phase below. They are recorded here
so a later phase does not relitigate them.

**Collectors live in `libsysmon`, not in `etop`.** They follow the rules in
[`packages/libsysmon/src/collectors/proc.ts`](../packages/libsysmon/src/collectors/proc.ts):
readers never throw, readers never parse and parsers never read, and every root
path is an option rather than a constant so the reader is testable against a
fixture tree on a machine with no `/proc`. This costs a `libsysmon` version bump
per phase and buys collectors the `cpumon` CLI and any other consumer can use.

**Native sources, never a subprocess.** No `systemctl`, no `docker ps`, no `ss`,
no `iwctl`. A subprocess per screen per refresh is both a cost and a parsing
contract that drifts between tool versions. The docker socket speaks HTTP,
`/proc/net` is a file, and D-Bus is a unix socket with a documented wire format.
All three are reachable from Node with no dependency.

> **Amended by [phase 06](./06-tunnels.md).** The rule above is about
> **collectors**, and for collectors it stands unchanged: `libsysmon` still
> contains no `child_process` call, and phase 06 did not add one or bump its
> version.
>
> What phase 06 added is a subprocess in `@aibulat/etop` that is not a
> collector. `ssh -N -L …` is an *action the user asked for*, spawned once when
> they ask and supervised until they stop asking. It is not sampled on a timer,
> and nothing about the dashboard's data path depends on it. The distinction
> that matters: a collector answers "what is the machine doing"; this answers
> "do the thing I configured". The former must never shell out. The latter has
> no native alternative — the ssh protocol together with the user's
> `~/.ssh/config`, agent, `known_hosts` and key formats is not something to
> reimplement, and OpenSSH is its only correct implementation.
>
> Three conditions keep the exception where it was drawn, and each is testable:
>
> 1. **Nothing parses ssh's output for facts about the machine.** Whether a
>    tunnel is carrying traffic is answered from `/proc` by `getConnections()`,
>    joined in `etop/src/tunnels/status.ts`. ssh's stderr is a failure message
>    and an input to retry-or-stop, never a data source.
> 2. **It lives in `packages/etop`**, behind an injectable `Spawner` seam
>    modelled on the `Killer` in `state/signals.ts`, so no test starts a real
>    ssh.
> 3. **It never inherits the terminal.** `stdio: ['ignore', 'ignore', 'pipe']`.
>
> One further exception to the rules below: `SlowPoller`'s `setActive` gates
> work by which screen is visible. The tunnel supervisor deliberately does not.
> A tunnel has to keep running while you are looking at the CPU graph.

**`Probe<T>` wraps a named key, never an array.** `Probe<Foo[]>` type-checks and
then loses `available` through `JSON.stringify`, because stringifying an array
drops every non-index property — in exactly the place a `--json` consumer needs
it. Write `Probe<{ units: SystemdUnit[] }>`.

**An entity present at only one end of a sampling window gets no rate.** Not a
zero. This is the rule `diffNetwork`, `diffProcesses` and `diffContainerCpu`
already follow, and the reason a container that started mid-window keeps an
`undefined` cpuPercentage instead of claiming to be idle.

**A screen that cannot read its source says so.** `ui/Unavailable.tsx` explains
the reason; `hooks/useLayout.ts` drops a panel entirely only when the reason is
`not-applicable` or `unsupported-platform`. Permission denied is an actionable
failure and keeps its screen. A dashboard that hides diagnostics is worse than
one that admits it does not know.
