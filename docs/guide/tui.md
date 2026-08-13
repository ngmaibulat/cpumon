# The dashboard

`cpumon-tui` is a full-screen terminal dashboard built on the same collectors as
the `cpumon` CLI: CPU with per-core detail, memory and swap, filesystem usage,
per-interface network throughput, an interactive process table, and container
cgroups.

```sh
npx cpumon-tui
```

It is a **separate package**. `cpumon` stays a small library with one runtime
dependency; the dashboard is an application that brings React and a terminal
renderer with it, and nobody importing `SystemMonitor` should have to carry
that. `cpumon-tui` depends on `cpumon`; nothing depends on the dashboard.

```sh
npm install -g cpumon-tui     # then just: cpumon-tui
```

Node 22 or newer. `cpumon` itself still supports Node 18.

## Options

```
  -i, --interval <ms>  sampling interval in milliseconds  (default: 1000)
      --mount <path>   filesystem the disk panel reports on
      --theme <name>   auto, default, ansi16 or mono
      --graph <style>  auto, block, braille or ascii
      --allow-kill     enable sending signals to processes from the table
      --no-color       draw without colour
  -v, --version        print version and exit
  -h, --help           show this help and exit
```

## Keys

Press `?` inside the dashboard for the same list. It is generated from the
binding table that dispatches the keys, so it cannot describe one that does
nothing.

### Anywhere

| Key | Action |
| --- | --- |
| `q` `Ctrl-C` | quit |
| `?` `F1` | show or hide the help |
| `Esc` | close an overlay, cancel a filter, unmaximise |
| `Tab` `Shift-Tab` | focus the next or previous panel |
| `1` … `6` | focus cpu, memory, disk, network, processes, containers |
| `Space` | freeze the view; sampling continues underneath |
| `+` `-` | halve or double the sampling interval |
| `f` | maximise the focused panel |
| `r` | clear history, unpause, drop the filter |
| `t` | cycle the colour theme |
| `Ctrl-G` | cycle the graph style: block, braille, ascii |

### Processes

| Key | Action |
| --- | --- |
| `j` `k` `↑` `↓` | move the selection |
| `Ctrl-D` `Ctrl-U` `PgUp` `PgDn` | page the selection |
| `g` `G` `Home` `End` | jump to the first or last row |
| `c` `m` `p` `n` `s` | sort by cpu, memory, pid, name, threads |
| `<` `>` | move the sort one column left or right |
| `R` | reverse the sort |
| `/` | filter by name or pid |
| `Enter` | expand the selected row |
| `K` | send a signal to the selected process |

### Network

| Key | Action |
| --- | --- |
| `←` `→` | cycle the interface |
| `u` | show throughput in bits or bytes |

## Pausing

`Space` freezes the **view**, not the sampling. The monitor keeps reading, so
resuming shows the present rather than replaying the moment you froze it — and
the history graphs have no gap in them.

## Filtering

`/` opens an incremental filter over the process table, matching on command name
or pid. `Esc` cancels and restores whatever filter was there before; `Enter`
closes the bar and keeps the filter.

While a filter is open the dashboard collects **every** process rather than the
busiest few. Without that, filtering for an idle process would report "nothing
matches" — which is a shortage of rows to match against, not of matches, and the
difference is invisible from the outside.

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

## Terminals

The dashboard adapts rather than assuming:

| | |
| --- | --- |
| **Colour** | Truecolor and 256-colour terminals get the full theme; 16-colour terminals get named colours; `NO_COLOR` or `--no-color` gets a monochrome theme that stays legible through bold, dim and inverse. |
| **Glyphs** | A non-UTF-8 locale or the Linux console gets ASCII graphs, ASCII meters and ASCII box-drawing, with nothing outside ASCII in the frame. |
| **Braille** | `--graph=braille` packs two samples per cell, so the same panel shows twice the history. It is never chosen automatically: a font missing the U+28xx block substitutes a glyph of a different width, which cannot be detected at runtime and tears the whole frame. |
| **Size** | Panels are dropped whole rather than squeezed. Below 80×16 the dashboard shows one panel at a time and `Tab` walks them. Below 40×10 it says so and draws nothing else. |

It refuses to start, with a message on stderr and exit code 1, when stdout is
not a terminal, when stdin has been redirected (Ink needs raw mode to read
keys), under CI, or when `TERM` is unset or `dumb`. In each case it points at
`cpumon --json`, which is what you actually wanted if you got there by piping.

## What is missing on your platform

Network, per-process figures and containers all come from `/proc`, so on macOS
and Windows those panels do not exist — they are removed from the layout and the
remaining panels reflow into the space, with one line in the footer saying why.

A panel is only removed when the concept does not exist on the platform. A read
that failed for a reason you could act on — a permission denied, a missing file,
a kernel interface that would not parse — keeps its panel and says what
happened. A monitoring tool that hides its own diagnostics is worse than one
that admits it does not know.

## Inside a container

The dashboard reports the container's limits, not the host's: memory comes from
the cgroup, so a container capped at 512 MiB shows 512 MiB.

The container panel says so explicitly when it can only see its own cgroup. A
list with one row in it means something very different depending on whether you
are looking at a machine or through a keyhole, and that is exactly the
distinction a dashboard is otherwise good at hiding.
