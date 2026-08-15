# Options

```sh
npx @aibulat/etop [options]
```

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

So a half-second refresh with signals enabled is:

```sh
npx @aibulat/etop --interval 500 --allow-kill
```

`--interval` can also be changed while running, with `+` and `-`.

`--theme` and `--graph` both default to `auto`, which decides from what the
terminal reports it can do. [Terminals and platforms](/guide/terminals) covers
what that detection looks at, and why `braille` is never chosen for you.

`--allow-kill` is off by default. With it, `K` on a selected process opens a
confirmation modal; see [sending signals](/guide/panels#sending-signals).

## `etop tunnel`

The tunnels, without the dashboard. `etop tunnel up` is a drop-in replacement
for an `ssh -L …` shell alias that also reconnects.

```sh
etop tunnel list              # the tunnels the config declares
etop tunnel status            # which local ports are listening, and who holds them
etop tunnel up squid          # run it in the foreground, reconnecting; Ctrl-C to stop
etop tunnel up --all          # every tunnel marked autostart
etop tunnel edit              # open the config in $VISUAL or $EDITOR
```

| Flag | Meaning |
| --- | --- |
| `--config <path>` | read this config instead of `$XDG_CONFIG_HOME/etop/tunnels.json` |
| `--json` | `list` and `status`: machine-readable output |
| `--all` | `up`: start every tunnel marked `autostart` |

`status` reports what is observable rather than what it would like to be true:
a port is bound or it is not, and the owner is whoever `/proc` says holds it. It
therefore sees tunnels started by anything at all, including a shell alias you
still have running in another pane.

`up` stays in the foreground because the tunnels are its children and would die
with it. That is the same reason there is no `etop tunnel down` — see
[Screens](/guide/screens#there-is-no-down).
