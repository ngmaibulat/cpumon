// Bump versions across the workspace.
//
// Incrementing a number is the easy part. What this exists for is the thing that
// is easy to get wrong by hand and that release.ts then refuses to publish: etop's
// `libsysmon` range moving in step with libsysmon's version - and etop's own
// version moving with it, because a package whose dependency changed is a package
// whose contents changed.
//
//   bun run bump                    patch, every publishable package
//   bun run bump minor              minor, every publishable package
//   bun run bump patch libsysmon    one package, and whatever depends on it
//   bun run bump --dry-run          print what would happen, write nothing
//   bun run bump --no-git           write the files, skip the commit and tags

import { $ } from 'bun';
import { basename } from 'node:path';

import { DEP_FIELDS, ROOT, publishOrder, readPackages, type DepField, type Pkg } from './workspace.ts';


type Level = 'major' | 'minor' | 'patch';
type RangeEdit = { field: DepField; dep: string; from: string; to: string };

const LEVELS = ['major', 'minor', 'patch'] as const;
const FLAGS = ['--dry-run', '--no-git'];

const USAGE = 'usage: bun run bump [major|minor|patch] [package...] [--dry-run] [--no-git]';

const argv = process.argv.slice(2);
const unknown = argv.filter((a) => a.startsWith('-') && !FLAGS.includes(a));

if (unknown.length) {
    console.error(`unknown option${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}\n${USAGE}`);
    process.exit(1);
}

const dryRun = argv.includes('--dry-run');
const noGit = dryRun || argv.includes('--no-git');

const positional = argv.filter((a) => !a.startsWith('-'));

// A bare `bun run bump` is a patch, because that is what almost every release is.
// The level is only ever the first word, so `bump libsysmon` still parses.
const level: Level = LEVELS.includes(positional[0] as Level)
    ? (positional.shift() as Level)
    : 'patch';

const selectors = positional;


function next(version: string, level: Level): string | null
{
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '');
    if (!m) return null;

    const [major, minor, patch] = m.slice(1).map(Number) as [number, number, number];

    if (level === 'major') return `${major + 1}.0.0`;
    if (level === 'minor') return `${major}.${minor + 1}.0`;

    return `${major}.${minor}.${patch + 1}`;
}


// Preserve the operator and replace the version: `^0.5.0` -> `^0.5.1`. Anything
// that is not a plain range with one comparator - `workspace:*`, `*`, `latest`,
// a git url, a compound range - comes back null and is left alone. Rewriting
// those would mean reimplementing semver range algebra to guess an intent the
// author already wrote down.
function rewrite(range: string, to: string): string | null
{
    const m = /^(\^|~|>=|<=|>|<|=|v)?(\d+\.\d+\.\d+)$/.exec(range.trim());
    if (!m) return null;

    return `${m[1] ?? ''}${to}`;
}


function relative(path: string): string
{
    return path.replace(ROOT, '');
}


function git(...args: string[]): string
{
    const proc = Bun.spawnSync(['git', ...args], { cwd: ROOT });

    if (proc.exitCode !== 0) {
        throw new Error(`git ${args.join(' ')} failed:\n${proc.stderr.toString().trim()}`);
    }

    return proc.stdout.toString().trim();
}


function tagExists(tag: string): boolean
{
    // rev-parse exits 1 for a ref that is not there, so this cannot go through git()
    return Bun.spawnSync(['git', 'rev-parse', '-q', '--verify', `refs/tags/${tag}`], { cwd: ROOT })
        .exitCode === 0;
}


const all = await readPackages();
const publishable = all.filter((p) => !p.private);

const problems: string[] = [];
const notes: string[] = [];

// 1. what was asked for
let selected: Pkg[] = [];

if (selectors.length) {
    for (const selector of selectors) {
        // by package name or by directory: `@aibulat/etop` and `etop` both work,
        // and the short one is what anyone actually types
        const match = all.find((p) => p.name === selector || basename(p.dir) === selector);

        if (!match) {
            problems.push(
                `no workspace package matches "${selector}". `
                + `Publishable packages: ${publishable.map((p) => p.name).join(', ')}`,
            );
            continue;
        }

        if (match.private) {
            problems.push(`${match.name} is private and never published - there is no version to bump`);
            continue;
        }

        selected.push(match);
    }
}
else selected = publishable;

if (!problems.length && !selected.length) problems.push('no publishable packages found');

// 2. the new versions, and the cascade. A package whose dependency range moves is
//    a package whose contents changed: publishing etop against a new libsysmon
//    without bumping etop leaves the change stranded, because the version already
//    on the registry is the one consumers keep resolving to.
const bumped = new Map<string, string>();

function plan(pkg: Pkg): void
{
    if (bumped.has(pkg.name)) return;

    const to = next(pkg.version, level);

    if (!to) {
        problems.push(
            `${pkg.name} is at version "${pkg.version}" - only plain x.y.z versions are bumped, `
            + 'so this one has to be edited by hand',
        );
        return;
    }

    bumped.set(pkg.name, to);
}

for (const pkg of selected) plan(pkg);

// Fixpoint rather than one pass: a dependent of a dependent has to come along too.
for (;;) {
    const before = bumped.size;

    for (const pkg of all) {
        if (pkg.private || bumped.has(pkg.name)) continue;

        const affected = DEP_FIELDS.some((field) =>
            Object.entries(pkg[field] ?? {}).some(([dep, range]) => {
                const to = bumped.get(dep);
                if (!to) return false;

                const rewritten = rewrite(range, to);
                return rewritten !== null && rewritten !== range;
            }));

        if (affected) plan(pkg);
    }

    if (bumped.size === before) break;
}

// 3. every edit, resolved before anything is written
const edits = new Map<Pkg, { version?: string; ranges: RangeEdit[] }>();

for (const pkg of all) {
    const ranges: RangeEdit[] = [];

    for (const field of DEP_FIELDS) {
        for (const [dep, range] of Object.entries(pkg[field] ?? {})) {
            const to = bumped.get(dep);
            if (!to) continue;

            const rewritten = rewrite(range, to);

            if (rewritten === null) {
                notes.push(
                    `${pkg.name}: leaving ${dep} at "${range}"`
                    + (range.startsWith('workspace:')
                        ? ' - release.ts refuses to publish a workspace: range, pin it to real semver'
                        : ' - not a plain semver range'),
                );
                continue;
            }

            if (rewritten === range) continue;

            ranges.push({ field, dep, from: range, to: rewritten });
        }
    }

    const version = bumped.get(pkg.name);
    if (version || ranges.length) edits.set(pkg, { version, ranges });
}

// 4. the files themselves. The round-trip check is what lets this rewrite whole
//    manifests through JSON.stringify and still promise a diff of only the lines
//    that changed: if the file does not already serialise to exactly this form,
//    the honest answer is to refuse rather than to reformat someone's manifest.
const files = new Map<Pkg, { path: string; manifest: Record<string, unknown> }>();

for (const pkg of edits.keys()) {
    const path = `${pkg.dir}/package.json`;
    const text = await Bun.file(path).text();
    const manifest = JSON.parse(text);

    if (`${JSON.stringify(manifest, null, 4)}\n` !== text) {
        problems.push(
            `${relative(path)} is not 4-space-indented JSON with a trailing newline. `
            + 'Rewriting it would reformat the whole file, so bump it by hand.',
        );
        continue;
    }

    files.set(pkg, { path, manifest });
}

// 5. git has to be able to hold the result
if (!noGit) {
    const dirty = (await $`git status --porcelain`.cwd(ROOT).text()).trim();
    if (dirty) problems.push(`the worktree is dirty, and this commit has to be the bump alone:\n${dirty}`);

    for (const [name, version] of bumped) {
        const tag = `${name}@${version}`;
        if (tagExists(tag)) problems.push(`tag ${tag} already exists - that version has been cut before`);
    }
}

// The order packages publish in is the order they read in.
const ordered = publishOrder(all).filter((p) => edits.has(p));
const width = Math.max(0, ...ordered.map((p) => p.name.length));

for (const pkg of ordered) {
    const { version, ranges } = edits.get(pkg)!;

    const change = version
        ? `${pkg.version} -> ${version}`
        : 'dependencies only';

    const deps = ranges.map((r) => `${r.dep} ${r.from} -> ${r.to}`).join(', ');

    console.log(`${pkg.name.padEnd(width)}  ${change}${deps ? `  (${deps})` : ''}`);
}

for (const note of notes) console.log(`note: ${note}`);

if (problems.length) {
    console.error(`\nrefusing to bump:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
}

if (!edits.size) {
    console.log('nothing to bump');
    process.exit(0);
}

if (dryRun) {
    console.log('\ndry run, nothing written');
    process.exit(0);
}

for (const [pkg, file] of files) {
    const { version, ranges } = edits.get(pkg)!;

    if (version) file.manifest.version = version;

    for (const range of ranges) {
        (file.manifest[range.field] as Record<string, string>)[range.dep] = range.to;
    }

    await Bun.write(file.path, `${JSON.stringify(file.manifest, null, 4)}\n`);
}

// bun.lock does carry the workspace versions and the internal range, but bun 1.3
// leaves that section alone on a version bump and `--frozen-lockfile` accepts the
// drift, so this is almost always a no-op. It runs anyway, because it costs a
// second here and the alternative failure mode is a red CI on someone else's push.
console.log('\nchecking bun.lock...');

const install = Bun.spawnSync(['bun', 'install', '--lockfile-only'], {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
});

if (install.exitCode !== 0) {
    console.error(
        '\n`bun install --lockfile-only` failed. The manifests are already written; fix the cause '
        + 'and re-run it, or `git checkout -- .` to undo the bump.',
    );
    process.exit(install.exitCode ?? 1);
}

if (noGit) {
    console.log('\nwritten. --no-git: nothing committed or tagged');
    process.exit(0);
}

const tags = ordered.filter((p) => bumped.has(p.name)).map((p) => `${p.name}@${bumped.get(p.name)}`);
const message = `release: ${tags.join(', ')}`;

git('add', ...[...files.values()].map((f) => relative(f.path)), 'bun.lock');
git('commit', '-m', message);

for (const tag of tags) git('tag', '-a', tag, '-m', tag);

console.log(`\ncommitted "${message}"`);
console.log(`tagged ${tags.join(', ')}`);
console.log(
    '\npush with `git push --follow-tags` - a bare push leaves the tags behind. '
    + 'publish.yml releases from main once the manifests land there.',
);
