# cpumon

A system monitor for Node: CPU, memory, disk, network, processes and containers,
as a library, a CLI, or a full-screen terminal dashboard.

This repository is an npm workspace holding two published packages.

| package | what it is | install |
| --- | --- | --- |
| [`cpumon`](packages/cpumon) | the library and the `cpumon` CLI. One runtime dependency (chalk), Node >= 18. | `npm i cpumon` |
| [`cpumon-tui`](packages/cpumon-tui) | the `cpumon-tui` dashboard, built with Ink. Node >= 22. | `npm i -g cpumon-tui` |

They are separate packages on purpose. `cpumon` is something you depend on from
code, so it stays small and its install cost stays boring. The dashboard is an
application that happens to be distributed over npm, and it brings React and a
terminal renderer with it — a weight nobody importing `SystemMonitor` should
have to carry. `cpumon-tui` depends on `cpumon`; nothing depends on the
dashboard.

## Working on it

```sh
npm install                 # links both workspaces
npm run build               # builds both
npm test                    # runs both suites
npm run typecheck           # type-checks both

npm run cpumon -- --fetch   # the CLI, rebuilt first
npm run tui                 # the dashboard, rebuilt first
```

Per package: `npm test -w cpumon`, `npm run build -w cpumon-tui`, and so on.

One asymmetry worth knowing about: `cpumon` commits its `bin/` build output to
git, and `cpumon-tui` does not commit its `dist/`. That is deliberate rather
than an oversight — `bin/` mirrors `src/` one file at a time and its diffs are
readable, while `dist/` is a bundle that churns entirely on any change. The
dashboard builds from `prepack` instead.

## Docs

The VitePress site lives in `docs/` and covers both packages.

```sh
npm run docs:dev
```

## Licence

MIT.
