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
