# Using the dashboard

The dashboard is one of etop's [screens](./screens) — the tiled one, and the one
it opens on. Everything below applies to it and, where the same panel appears
full-screen, to that too.

## Pausing

`Space` freezes the **view**, not the sampling. The monitor keeps reading, so
resuming shows the present rather than replaying the moment you froze it — and
the history graphs have no gap in them.

`r` clears history, unpauses, and drops any filter, in one key.

## Filtering

`/` opens an incremental filter over the process table, matching on command name
or pid. `Esc` cancels and restores whatever filter was there before; `Enter`
closes the bar and keeps the filter.

While a filter is open the dashboard collects **every** process rather than the
busiest few. Without that, filtering for an idle process would report "nothing
matches" — which is a shortage of rows to match against, not of matches, and the
difference is invisible from the outside.

## Sorting

`c` `m` `p` `n` `s` sort by cpu, memory, pid, name and threads. `<` and `>` move
the sort one column left or right, which is quicker than remembering the letter,
and `R` reverses it. `Enter` expands the selected row for the full identity of
the process.

## Sending signals

Off unless you start with `--allow-kill`.

`K` — shift, not `k`, which is vim-up in the table right behind it — opens a
confirmation showing the process by name and pid, with a signal list defaulting
to `SIGTERM`. Confirm with `y`, not Enter: Enter is muscle memory in a list, and
a list is what you were just in.

The target is captured when the modal opens and the view is frozen while it is
up, so a row arriving or leaving underneath cannot turn a confirmation for one
process into a signal for another. `SIGKILL` sits at the bottom of the list,
below two recoverable options, and carries a warning about what it means.

The result — sent, `EPERM`, or a process that had already exited — is reported
in the footer.

## Inside a container

The dashboard reports the container's limits, not the host's: memory comes from
the cgroup, so a container capped at 512 MiB shows 512 MiB.

The container panel says so explicitly when it can only see its own cgroup. A
list with one row in it means something very different depending on whether you
are looking at a machine or through a keyhole, and that is exactly the
distinction a dashboard is otherwise good at hiding.
