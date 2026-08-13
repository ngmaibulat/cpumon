# Terminals and platforms

## What adapts

The dashboard adapts rather than assuming:

| | |
| --- | --- |
| **Colour** | Truecolor and 256-colour terminals get the full theme; 16-colour terminals get named colours; `NO_COLOR` or `--no-color` gets a monochrome theme that stays legible through bold, dim and inverse. |
| **Glyphs** | A non-UTF-8 locale or the Linux console gets ASCII graphs, ASCII meters and ASCII box-drawing, with nothing outside ASCII in the frame. |
| **Braille** | `--graph=braille` packs two samples per cell, so the same panel shows twice the history. It is never chosen automatically: a font missing the U+28xx block substitutes a glyph of a different width, which cannot be detected at runtime and tears the whole frame. |
| **Size** | Panels are dropped whole rather than squeezed. Below 80×16 the dashboard shows one panel at a time and `Tab` walks them. Below 40×10 it says so and draws nothing else. |

## When it refuses to start

It refuses, with a message on stderr and exit code 1, when stdout is not a
terminal, when stdin has been redirected (Ink needs raw mode to read keys),
under CI, or when `TERM` is unset or `dumb`.

In each case it points at `cpumon --json`, which is what you actually wanted if
you got there by piping.

## What is missing on your platform

Network, per-process figures and containers all come from `/proc`, so on macOS
and Windows those panels do not exist — they are removed from the layout and the
remaining panels reflow into the space, with one line in the footer saying why.

A panel is only removed when the concept does not exist on the platform. A read
that failed for a reason you could act on — a permission denied, a missing file,
a kernel interface that would not parse — keeps its panel and says what
happened. A monitoring tool that hides its own diagnostics is worse than one
that admits it does not know.
