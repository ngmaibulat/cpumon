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

## Releasing

Both packages publish from GitHub Actions with npm trusted publishing. There is no
npm token — not in the repo's secrets, not on a laptop. The workflow asks GitHub
for a short-lived OIDC claim, npm exchanges it for publish rights scoped to this
repository and to `.github/workflows/publish.yml` by name, and npm attaches a
provenance attestation to each tarball on the way out.

To cut a release:

```sh
bun run bump                    # patch both packages
bun run bump minor              # or minor, or major
bun run bump patch libsysmon    # or one package, and whatever depends on it
bun run bump --dry-run          # print the plan, write nothing

git push --follow-tags
```

`scripts/bump.ts` does the part that is easy to get wrong by hand: it moves
`@aibulat/etop`'s `libsysmon` range in step with `libsysmon`'s new version — and
bumps `@aibulat/etop` too when it does, because a package whose dependency moved
is a package whose contents changed, and leaving its version alone strands the
change on a version nobody resolves to. Then it commits and tags each package
`name@version`. It refuses to run on a dirty worktree, or when a tag it would
create already exists, and it only rewrites manifests it can round-trip through
`JSON.stringify` unchanged, so the diff is the version lines and nothing else.
`--follow-tags` is not optional: a bare `git push` leaves the tags behind.

Publishing then happens on its own. `publish.yml` runs when a commit touching
`packages/*/package.json` lands on `main` — a version can only change in those
files, and versions already on the registry are skipped, so a manifest edit that
is not a bump costs a minute and publishes nothing. The workflow is still
manually dispatchable from the Actions tab, which is where `dry_run` lives (it
packs the tarballs and validates everything without touching the registry) and
where you resume a release that died halfway from a commit that touches no
manifest.

`scripts/release.ts` is what actually runs, and most of it is refusal. It
publishes in dependency order, and before anything reaches the registry it checks
that the worktree is clean, that every workspace dependency range matches the
version being published alongside it, and that `typecheck` and `test` pass.
Versions already on the registry are skipped rather than failed, so re-running
after a release that died halfway picks up where it stopped.

The same script still works locally against a token — `bun run release` and
`bun run release:dry`, both of which need one, because `bun publish` asks to be
logged in even for a dry run. It notices the OIDC environment and switches from
`bun publish` to `npm publish` only there, because Bun has no OIDC exchange.

Two things live outside this repo and have to match it: the `npm-publish`
environment in the repository's settings, and each package's trusted publisher on
npmjs.com, which names `publish.yml` explicitly. Renaming that workflow file
revokes publishing until npm is updated to match.

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
