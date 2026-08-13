# cpumon

A system monitor for Node: CPU, memory, disk, network, processes and containers,
as a library, a CLI, or a full-screen terminal dashboard.

This repository is a Bun workspace holding two published packages.

| package | what it is | install |
| --- | --- | --- |
| [`cpumon`](packages/cpumon) | the library and the `cpumon` CLI. One runtime dependency (chalk), Node >= 18. | `bun add cpumon` |
| [`etop`](packages/etop) | the `etop` dashboard, built with Ink. Node >= 22. | `bun add -g etop` |

They are separate packages on purpose. `cpumon` is something you depend on from
code, so it stays small and its install cost stays boring. The dashboard is an
application that happens to be distributed over npm, and it brings React and a
terminal renderer with it — a weight nobody importing `SystemMonitor` should
have to carry. `etop` depends on `cpumon`; nothing depends on the
dashboard.

## Working on it

```sh
bun install                 # links both workspaces
bun run build               # builds both
bun test                    # runs both suites
bun run typecheck           # type-checks both

bun run cpumon -- --fetch   # the CLI, rebuilt first
bun run tui                 # the dashboard, rebuilt first
```

Per package: `bun run --filter cpumon test`, `bun run --filter etop build`, and
so on. The root scripts all fan out that way rather than calling `bun test` at
the root, and that is deliberate: Bun runs a whole suite in one process, and
`cpumon`'s render tests set `chalk.level = 0`, which would strip the colour the
dashboard's tests assert on. One process per package keeps them honest.

`bun run test:node` runs the same suites under `node --test`. Worth keeping,
because under `bun test` `process.execPath` is Bun — so the tests that spawn a
subprocess would otherwise stop exercising Node, which is what both packages
actually ship to.

One asymmetry worth knowing about: `cpumon` commits its `bin/` build output to
git, and `etop` does not commit its `dist/`. That is deliberate rather
than an oversight — `bin/` mirrors `src/` one file at a time and its diffs are
readable, while `dist/` is a bundle that churns entirely on any change. The
dashboard builds from `prepack` instead.

## Docs

The VitePress site lives in `docs/` and covers both packages.

```sh
bun run docs:dev
```

## Licence

MIT.
