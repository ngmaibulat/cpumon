# etop

A full-screen terminal dashboard for CPU, memory, disk, network, processes and
containers — built on [`libsysmon`](https://www.npmjs.com/package/libsysmon)'s
collectors, drawn with [Ink](https://github.com/vadimdemedes/ink).

```sh
npx @aibulat/etop
```

```
etop 0.1.0 · srv-01 · Linux 6.18.32 · up 5d 18h · 1.0s
╭────────────────────────────────────╮╭────────────────────────────────────╮
│CPU 16C                          21%││MEM                              66%│
│                    ▄▆▅▄▄▄▄▃▂▁▄▃▄▄▆▅││MEM  [███████▍   ] 14.7 / 22.3 GiB  │
│C00 [███████] 100% C01 [       ]  0% ││███████████████████████████▓▓▓░░░░░░│
│C02 [▊      ]  11% C03 [       ]  0% ││used 14.7 GiB  cache 2.3 GiB        │
╰────────────────────────────────────╯╰────────────────────────────────────╯
╭────────────────────────────────────╮╭────────────────────────────────────╮
│NET wlan0                      1/34 ││DISK /                           95%│
│↓ 87.9 KiB/s  total 216.2 MiB       ││[█████████████▍] 909.9 / 952.4 GiB  │
╰────────────────────────────────────╯╰────────────────────────────────────╯
╭────────────────────────────────────╮╭────────────────────────────────────╮
│PROC 42                             ││CONTAINERS 14                       │
│    PID %CPU▼       MEM THR S COMMAND│CONTAINER    RUNTIME %CPU   MEM LIMIT│
│2119963  56.5 475.5 MiB  38 S chromiu│101204468cc9 docker   0.0 1.1 G    ∞ │
╰────────────────────────────────────╯╰────────────────────────────────────╯
q quit · ? help · Tab panel · Space pause · / filter
```

## Install

```sh
npm install -g @aibulat/etop
etop
```

Node 22 or newer. If you only want numbers to script against, install
[`libsysmon`](https://www.npmjs.com/package/libsysmon) instead — it runs on Node 18,
has one runtime dependency, and `cpumon --json` pipes into `jq`.

## Keys

`?` inside the dashboard shows them all. The essentials:

| Key | |
| --- | --- |
| `q` | quit |
| `Tab` `1`–`6` | move between panels |
| `Space` | freeze the view (sampling continues) |
| `/` | filter processes by name or pid |
| `c` `m` `p` `n` `s` | sort the process table |
| `+` `-` | change the sampling interval |
| `K` | send a signal — needs `--allow-kill` |

## Options

```
  -i, --interval <ms>  sampling interval in milliseconds  (default: 1000)
      --mount <path>   filesystem the disk panel reports on
      --theme <name>   auto, default, ansi16 or mono
      --graph <style>  auto, block, braille or ascii
      --allow-kill     enable sending signals to processes from the table
      --no-color       draw without colour
```

## Notes

**It adapts to the terminal rather than assuming one.** Truecolor, 256-colour,
16-colour and monochrome all get a theme that stays legible; a non-UTF-8 locale
or the Linux console gets ASCII graphs and borders with nothing outside ASCII in
the frame. Panels are dropped whole rather than squeezed as the window shrinks,
down to a single-panel mode that `Tab` walks.

**It is honest about what it cannot read.** Network, per-process figures and
containers need `/proc`, so on macOS and Windows those panels are removed and
the rest reflow, with one line saying why. A read that failed for a reason you
could act on keeps its panel and reports the reason instead.

**Signals are off by default.** `--allow-kill` turns them on; the confirmation
names the process, pins it when the modal opens, freezes the list underneath,
defaults to `SIGTERM`, and confirms on `y` rather than Enter.

Full documentation: <https://github.com/ngmaibulat/cpumon#readme>

## Licence

MIT.
