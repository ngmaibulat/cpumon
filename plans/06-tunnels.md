# Phase 06 — SSH tunnels

> **Status: shipped** in `@aibulat/etop` 0.7.0.

## What it solved

Tunnels were shell aliases:

```sh
squid='ssh -L 3128:localhost:3128 -L 1194:localhost:1194 root@128.199.47.190'
```

That works until it doesn't. The alias is invisible outside the shell that
defined it, there is no way to see whether the tunnel is actually carrying
anything, and when the link drops it stays dead until somebody notices.

So: a declared config, a screen that shows state, and a supervisor that
reconnects — plus `etop tunnel up`, which is the alias replacement for anyone
who does not want a dashboard open to keep a proxy running.

## The standing decision this amends

`plans/README.md` said: *"Native sources, never a subprocess."* This phase is
the first thing in either package to call `child_process`, and the amendment is
recorded there rather than left implicit here.

The short of it: **that rule was about collectors.** A subprocess per screen per
refresh is a cost paid on a timer and a parsing contract that drifts between
tool versions. A tunnel is not sampled — it is a process the user asked to
exist — and there is no native way to hold an SSH connection open. The ssh
protocol plus the user's `~/.ssh/config`, agent, `known_hosts` and key formats
are not things to reimplement, and OpenSSH is the only correct implementation of
them.

Three conditions keep it narrow, and all three are load-bearing:

1. **Nothing parses ssh's stdout for facts.** Its stderr is kept only as a
   human-readable failure reason and as input to `classifyExit`, which decides
   *retry or stop* — never what the machine is doing.
2. **It is confined to `packages/etop`.** `libsysmon` still contains no
   `child_process` call, and this phase did not bump its version. That is the
   evidence the exception stayed where it was drawn.
3. **It never inherits the terminal.** The supervisor spawns with
   `stdio: ['ignore', 'ignore', 'pipe']`. A child writing to the alternate
   screen corrupts it in a way no later frame washes out.

## Why the screen has two columns for "is it up"

`STATE` is what the supervisor believes. `BOUND` is what `/proc` says.

Keeping them apart is the most important decision in the phase. A live ssh
proves ssh is running; a listening port proves the forward exists. Those are
different claims, and the gap between them — ssh alive, ports not bound — is
exactly the failure that is otherwise invisible. A single merged "up" column
would hide it behind a green word.

`BOUND` costs nothing to compute. `getConnections()` is already in the
collector list in `index.ts` for the `conn` screen, so this is a join against a
snapshot that had to be taken anyway: no new sampling, no new socket, no
subprocess. `tunnels/status.ts` is the whole of it and is pure.

This showed up live during development. With the old shell alias still holding
3128 and 1194, starting the configured tunnel gave `STATE backoff` and `BOUND
2/2` — the ports were bound, by somebody else's ssh, while ours could not start.
One column could not have said that.

## `ssh -N` never says it worked

There is no success line to wait for, so the supervisor promotes `starting` to
`up` when the child is still alive after two seconds. That definition is only
honest because of `-o ExitOnForwardFailure=yes`: without it, a port already in
use leaves ssh happily connected and forwarding nothing, and the grace timer
would call that up. If that option is ever dropped, this rule silently becomes a
lie — which is why `tunnel-ssh.test.js` asserts it with the reasoning attached.

The other defaults, and what each buys:

- `ServerAliveInterval=15` / `ServerAliveCountMax=3` — what make reconnection
  *happen*. On a wifi drop the TCP connection goes half-open; without keepalives
  the child lives for hours, the supervisor sees a healthy process, and the
  tunnel forwards into a black hole.
- `BatchMode=yes` — a supervised child has no terminal, so a passphrase prompt
  would block for ever on a stdin that never arrives and the screen would sit in
  `starting` until someone gave up. This turns that into an immediate
  `Permission denied`, which `classifyExit` reports as "add the key to your
  agent". The cost — a passphrase-protected key with no agent does not work — is
  the right trade for something unattended, and `options` can override it.
- `ConnectTimeout=10` — bounds a `starting` that would otherwise sit through the
  kernel's whole SYN retry schedule.

## Fatal versus retryable

ssh exits 255 for nearly everything, so the code says almost nothing and the
stderr text is the discriminator. A typo in a hostname fails identically for
ever, and retrying it every second is a hot loop with a misleading "retrying" on
screen — so `Permission denied`, `Host key verification failed`, `Could not
resolve hostname` and `Bad configuration option` are terminal.

Everything unrecognised is **retryable**. The cost of retrying something fatal
is a slow loop with a visible reason; the cost of giving up on something
transient is a tunnel that stays down all night.

Backoff is `min(60s, 1s × 2^attempt)` under full jitter, reset once a connection
has held sixty seconds. The jitter is not decoration: two tunnels to the same
host drop together when the link goes, and without it they retry in lockstep for
the whole outage.

## Three bugs the tests found, worth keeping

**A restart cannot be a stop followed by a start.** `SIGTERM` is asynchronous,
so the old child is still there when the start runs, and `#start` refuses to
spawn a second one over it. The tunnel stopped and never came back — on every
config edit, which is the most common case there is. Fixed with an explicit
`restartAfterExit` flag that `#onExit` honours.

**A published snapshot must not share its mutable ring.** The stderr tail was
trimmed by reassigning the array, which left the last published frame holding
the old one — so a bounded eight-line buffer reported nine. Trimmed in place
now, and copied on publish.

**Unref'd timers are right under ink and wrong in a CLI.** Every supervisor
timer is `unref()`'d on the SlowPoller rule that nothing may hold the event loop
open. Under `etop tunnel up` there is no ink, so once the child exited and only
the retry timer remained, node drained the loop and exited mid-backoff: the
first failure printed "retrying" and the process was gone before it could.
`waitForSignal` holds a ref'd handle.

## The `e` key

ink 7.1.1 has `suspendTerminal` on `useApp()`, documented for exactly this. It
flushes, erases the frame, leaves the alternate screen and drops raw mode; while
suspended it keeps rendering and *discards every write*; on the way back it
restores all of it and forces a **full redraw rather than a diff** against the
frame the editor drew over.

Nothing unmounts, so the reducer state, the sampling and the running tunnels all
survive the edit. An earlier draft of this plan proposed unmounting ink and
re-rendering from a saved `UiState`; that would have lost the graph history and
is strictly worse.

The piece that is easy to miss: `lifecycle.suspend()`. The editor is spawned
with the terminal inherited and in etop's process group — which is what makes it
the foreground job — so a Ctrl-C typed at vim is delivered to etop as well.
Without detaching the signal handlers first, that would unmount ink and exit 130
while vim still owned the screen. This is what `system(3)` does, for the reason.

## There is no `etop tunnel down`

It looks feasible: find the LISTEN socket on the tunnel's port, read its owner
pid, signal it. It is not.

Two etop instances with the same config produce byte-identical argv, and so does
a hand-typed alias in another pane. `/proc/[pid]/cmdline` is unreadable for
other users, so the scan is incomplete in precisely the cases where guessing is
most dangerous. Killing "the ssh whose arguments resemble mine" is a destructive
action taken on a guess, and this codebase has exactly one destructive action —
`state/signals.ts` and the pinned `killTarget` exist entirely to guarantee the
opposite: the pid signalled is the pid the user saw.

Ctrl-C stops a foreground supervisor. `x` stops a tunnel whose pid this process
owns and knows. If cross-process control is ever wanted, the honest design is a
control socket per tunnel — a real identity, not a string match — and that is a
different phase.

## What also changed

- `SCREEN_ORDER` gained `tunnels`, eight tabs. They total 50 of the 80-column
  minimum, so nothing had to be shortened.
- `cli-args.ts` gained a router *above* `parseCliArgs`, which keeps
  `allowPositionals: false` and its "a positional argument is rejected" test
  verbatim. The tunnel parser has its own flag set; neither help text can drift
  into describing the other's flags.
- `term/lifecycle.ts` gained `suspend()`.
- **Bug fix, pre-existing:** `screens.test.js`'s truncated-bar test asserted
  "wifi is last", which stopped being true the moment a screen was added after
  it. It now reads the last entry out of `SCREEN_ORDER`.

## Known, not fixed

- `resolveEditor` falls back to `nvim`/`vim`/`hx`/`vi` when neither `$VISUAL`
  nor `$EDITOR` is set, rather than refusing. Both are unset on a default
  install, and "press `e`, get told to configure a shell variable" is not what
  the key is for. `$VISUAL` and `$EDITOR` still win whenever they are set.
- The suspend is the one part with no automated test — `renderToString` has no
  terminal to hand over. It was verified by driving the real binary under a pty
  with a scripted editor that takes its own alternate screen; the dashboard
  returns, the config reloads, and a tunnel whose command changed restarts.
- A `SIGKILL` to etop orphans the children. Nothing can help that; `dispose()`
  covers every other path.
