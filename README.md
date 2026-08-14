# cpumon

A system monitor for Node: CPU, memory, disk, network, processes and containers,
as a library, a CLI, or a full-screen terminal dashboard.

This repository is a Bun workspace holding two published packages.

| package | what it is | install |
| --- | --- | --- |
| [`libsysmon`](packages/libsysmon) | the library, and the `cpumon` CLI it ships. One runtime dependency (chalk), Node >= 18. | `bun add libsysmon` |
| [`@aibulat/etop`](packages/etop) | the `etop` dashboard, built with Ink. Node >= 22. | `npx @aibulat/etop` |

The package is `libsysmon`; the command it installs is still `cpumon`. That is
deliberate — the library and the terminal command are named for what each of
them is — but it does mean `npx cpumon` no longer reaches this project. Use
`npx -p libsysmon cpumon`, or install it and just run `cpumon`. The dashboard is
the same shape: the package is `@aibulat/etop`, the command it installs is
`etop`. There the scope saves you — `npx @aibulat/etop` reaches the right package
because the bin name matches the package's last path segment, so the docs use
that form throughout, and bare `etop` is what you get after
`npm install -g @aibulat/etop`.

They are separate packages on purpose. `libsysmon` is something you depend on from
code, so it stays small and its install cost stays boring. The dashboard is an
application that happens to be distributed over npm, and it brings React and a
terminal renderer with it — a weight nobody importing `SystemMonitor` should
have to carry. `etop` depends on `libsysmon`; nothing depends on the
dashboard.

## Working on it

```sh
bun install                 # links both workspaces
bun run build               # builds both
bun test                    # runs both suites
bun run typecheck           # type-checks both

bun run cpumon -- --fetch   # the CLI, rebuilt first
bun run etop                # the dashboard, rebuilt first
```

Per package: `bun run --filter libsysmon test`, `bun run --filter @aibulat/etop build`, and
so on. The root scripts all fan out that way rather than calling `bun test` at
the root, and that is deliberate: Bun runs a whole suite in one process, and
`libsysmon`'s render tests set `chalk.level = 0`, which would strip the colour the
dashboard's tests assert on. One process per package keeps them honest.

`bun run test:node` runs the same suites under `node --test`. Worth keeping,
because under `bun test` `process.execPath` is Bun — so the tests that spawn a
subprocess would otherwise stop exercising Node, which is what both packages
actually ship to.

One asymmetry worth knowing about: `libsysmon` commits its `bin/` build output to
git, and `etop` does not commit its `dist/`. That is deliberate rather
than an oversight — `bin/` mirrors `src/` one file at a time and its diffs are
readable, while `dist/` is a bundle that churns entirely on any change. The
dashboard builds from `prepack` instead.

## Docs

One VitePress site per package, under `apps/`. They are separate because the
packages release separately, and a shared site would have to pretend otherwise.

```sh
bun run docs:libsysmon      # apps/libsysmon-docs
bun run docs:etop           # apps/etop-docs
bun run docs:build          # builds both
```

Both are configured for `base: '/'`, i.e. each site owning its own domain. If
they ever share a host, the second one needs a path prefix and every asset and
internal link in it resolves against that prefix.

## Licence

MIT.
