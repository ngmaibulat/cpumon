// Publish every package in packages/, in dependency order.
//
// `bun run --filter './packages/*' publish` would very nearly do this, and it is
// not enough. Publishing is the one thing in this repo that cannot be undone -
// npm allows an unpublish for 72 hours and then the version number is spent
// forever - so the interesting part is not the ordering, it is everything this
// refuses to do.
//
// Every check runs against every package BEFORE anything is published. A release
// that fails halfway leaves the registry in a state no commit describes: etop
// published against a libsysmon that is not there yet, and no way back.

import { $ } from 'bun';

const ROOT = new URL('..', import.meta.url).pathname;
const dryRun = process.argv.includes('--dry-run');


type Pkg = {
    dir: string;
    name: string;
    version: string;
    private?: boolean;
    dependencies?: Record<string, string>;
};


async function readPackages(): Promise<Pkg[]>
{
    const { Glob } = await import('bun');
    const found: Pkg[] = [];

    for (const rel of new Glob('packages/*/package.json').scanSync({ cwd: ROOT })) {
        const manifest = await Bun.file(`${ROOT}${rel}`).json();
        found.push({ ...manifest, dir: `${ROOT}${rel.replace('/package.json', '')}` });
    }

    return found;
}


// Topological, not hardcoded: adding a third package should not quietly
// reintroduce the ordering bug this exists to prevent.
function publishOrder(pkgs: Pkg[]): Pkg[]
{
    const byName = new Map(pkgs.map((p) => [p.name, p]));
    const ordered: Pkg[] = [];
    const seen = new Set<string>();

    function visit(pkg: Pkg, trail: string[])
    {
        if (seen.has(pkg.name)) return;

        if (trail.includes(pkg.name)) {
            throw new Error(`dependency cycle: ${[...trail, pkg.name].join(' -> ')}`);
        }

        for (const dep of Object.keys(pkg.dependencies ?? {})) {
            const local = byName.get(dep);
            if (local) visit(local, [...trail, pkg.name]);
        }

        seen.add(pkg.name);
        ordered.push(pkg);
    }

    for (const pkg of pkgs) visit(pkg, []);

    return ordered;
}


async function publishedVersions(name: string): Promise<Set<string>>
{
    const res = await fetch(`https://registry.npmjs.org/${name}`);

    // a name nobody has ever published is the normal case for a first release
    if (res.status === 404) return new Set();
    if (!res.ok) throw new Error(`registry lookup for ${name} failed: ${res.status}`);

    return new Set(Object.keys((await res.json()).versions ?? {}));
}


// Bun 1.3 does not read `_authToken` out of ~/.npmrc the way npm does - it gives
// up before it ever reaches the registry - but it does honour NPM_CONFIG_TOKEN.
// So the credential gets resolved here and handed to the child explicitly.
//
// The default registry only, to match the lookup above: no `_auth`, no scoped
// registry mapping. Widening this is reimplementing npm's config resolution.
async function npmToken(): Promise<string | undefined>
{
    const fromEnv = process.env.NPM_CONFIG_TOKEN ?? process.env.NPM_TOKEN;
    if (fromEnv) return fromEnv;

    const npmrc = Bun.file(`${process.env.HOME}/.npmrc`);
    if (!(await npmrc.exists())) return undefined;

    for (const line of (await npmrc.text()).split('\n')) {
        const [key, ...rest] = line.split('=');
        if (key.trim() !== '//registry.npmjs.org/:_authToken') continue;

        // npm allows ${VAR} in .npmrc, and quotes around the value
        return rest.join('=').trim()
            .replace(/^["']|["']$/g, '')
            .replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? '');
    }

    return undefined;
}


const packages = (await readPackages()).filter((p) => !p.private);
const order = publishOrder(packages);

console.log(`release order: ${order.map((p) => `${p.name}@${p.version}`).join(' -> ')}\n`);

const problems: string[] = [];

// 1. a release has to describe a commit, or the tarball and the tag disagree
const dirty = (await $`git status --porcelain`.cwd(ROOT).text()).trim();
if (dirty) problems.push(`the worktree is dirty:\n${dirty}`);

// 2. what is on the registry already, and what each package will resolve to
const registry = new Map<string, Set<string>>();
for (const pkg of order) registry.set(pkg.name, await publishedVersions(pkg.name));

const skip = new Set<string>();

for (const pkg of order) {
    if (registry.get(pkg.name)!.has(pkg.version)) {
        // not an error: this is what a re-run after a half-failed release looks
        // like, and refusing it would make the failure harder to recover from
        skip.add(pkg.name);
        console.log(`${pkg.name}@${pkg.version} is already published, will skip`);
    }
}

// 3. the check that ordering alone cannot make: does each workspace dependency
//    range actually match the version being published? Publishing etop against
//    `libsysmon: ^0.6.0` while libsysmon sits at 0.5.0 succeeds at the registry
//    and fails at every `npm install` afterwards.
const versionOf = new Map(order.map((p) => [p.name, p.version]));

for (const pkg of order) {
    for (const [dep, range] of Object.entries(pkg.dependencies ?? {})) {
        const local = versionOf.get(dep);
        if (!local) continue;

        if (range.startsWith('workspace:')) {
            problems.push(
                `${pkg.name} depends on ${dep} as "${range}". bun publish rewrites that, `
                + 'but npm publish does not - and this repo has shipped with plain semver. '
                + 'Pin it to a real range.',
            );
            continue;
        }

        if (!Bun.semver.satisfies(local, range)) {
            problems.push(
                `${pkg.name} depends on ${dep}@${range}, but ${dep} is at ${local}. `
                + `Publishing this pair makes ${pkg.name} uninstallable.`,
            );
        }
    }
}

// 4. the credential itself. bun publish only notices a missing token after it has
//    packed the tarball, which on a multi-package release is late enough to stop
//    halfway - the one state this script exists to avoid.
const token = await npmToken();
const willPublish = order.some((p) => !skip.has(p.name));

if (willPublish && !token) {
    problems.push('no npm credentials: run `bunx npm login`, or set NPM_CONFIG_TOKEN');
}
else if (willPublish) {
    const who = Bun.spawnSync(['bun', 'pm', 'whoami'], {
        cwd: ROOT,
        env: { ...process.env, NPM_CONFIG_TOKEN: token! },
    });

    if (who.exitCode !== 0) problems.push(`npm rejected the token: ${who.stderr.toString().trim()}`);
    else console.log(`authenticated as ${who.stdout.toString().trim()}`);
}

// 5. everything the CI this repo does not have would otherwise catch
if (!dryRun) {
    console.log('\nverifying...');
    for (const script of ['typecheck', 'test']) {
        const proc = Bun.spawnSync(['bun', 'run', script], { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' });
        if (proc.exitCode !== 0) problems.push(`\`bun run ${script}\` failed`);
    }
}

if (problems.length) {
    console.error(`\nrefusing to publish:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
}

// Only now, with every package checked, does anything reach the registry.
const publishEnv = token ? { ...process.env, NPM_CONFIG_TOKEN: token } : process.env;

for (const pkg of order) {
    if (skip.has(pkg.name)) continue;

    console.log(`\npublishing ${pkg.name}@${pkg.version}`);

    const args = ['publish', '--cwd', pkg.dir, ...(dryRun ? ['--dry-run'] : [])];
    const proc = Bun.spawnSync(['bun', ...args], {
        cwd: ROOT,
        env: publishEnv,
        stdout: 'inherit',
        stderr: 'inherit',
    });

    if (proc.exitCode !== 0) {
        console.error(
            `\n${pkg.name} failed to publish. Anything before it in the order is already on the `
            + 'registry; fix the cause and re-run - published versions are skipped.',
        );
        process.exit(proc.exitCode ?? 1);
    }
}

console.log(dryRun ? '\ndry run complete, nothing published' : '\ndone');
