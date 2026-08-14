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

import { ROOT, publishOrder, readPackages } from './workspace.ts';

const dryRun = process.argv.includes('--dry-run');

// npm trusted publishing: GitHub Actions sets both of these, and only when the
// job asked for `id-token: write`. Their presence is the whole signal - there is
// no credential to look for, because npm mints a short-lived one from the OIDC
// claim at publish time.
//
// bun publish cannot do that exchange (oven-sh/bun#22423), so this is also the
// switch that decides which publisher runs below.
const oidc = Boolean(
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
);


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

console.log(`release order: ${order.map((p) => `${p.name}@${p.version}`).join(' -> ')}`);
console.log(oidc ? 'auth: trusted publishing (npm, OIDC)\n' : 'auth: token (bun)\n');

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

// Every version is already out. Since publish.yml runs on every push that touches
// a manifest, this is the common case - and there is nothing left for the checks
// below to protect, including the verify step, which is the expensive one.
if (skip.size === order.length) {
    console.log('\nnothing to publish');
    process.exit(0);
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
const willPublish = order.some((p) => !skip.has(p.name));
let token: string | undefined;

if (oidc) {
    // Nothing to authenticate ahead of time: the exchange happens inside npm
    // publish. What can be checked early is the npm doing it - an older npm has
    // no exchange at all and fails with a bare 401 that names no cause.
    // spawnSync throws rather than returning when the binary is not there at all
    let npmVersion = '';
    try {
        npmVersion = Bun.spawnSync(['npm', '--version']).stdout.toString().trim();
    }
    catch { /* reported as "missing" below */ }

    if (!Bun.semver.satisfies(npmVersion, '>=11.5.1')) {
        problems.push(`trusted publishing needs npm >= 11.5.1, this one is ${npmVersion || 'missing'}`);
    }
    else console.log(`publishing with npm ${npmVersion}`);
}
else {
    token = await npmToken();

    // Not gated on dryRun: `bun publish --dry-run` asks for a credential too, and
    // only after it has packed every file. Failing here says the same thing three
    // screens earlier. (`npm publish --dry-run` does not, which is why the OIDC
    // branch above needs nothing.)
    if (willPublish && !token) {
        problems.push('no npm credentials: run `bunx npm login`, or set NPM_CONFIG_TOKEN');
    }
    else if (willPublish) {
        const who = Bun.spawnSync(['bun', 'pm', 'whoami'], {
            cwd: ROOT,
            env: { ...process.env, NPM_CONFIG_TOKEN: token },
        });

        if (who.exitCode !== 0) problems.push(`npm rejected the token: ${who.stderr.toString().trim()}`);
        else console.log(`authenticated as ${who.stdout.toString().trim()}`);
    }
}

// 5. the suite, again. ci.yml runs it on every push, but a release is the one
//    place where "it passed on some earlier commit" is not good enough.
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

    // npm publish has no --cwd; it takes the package from the process cwd. Both
    // packages declare prepack, and both prepack scripts shell out to bun, so bun
    // has to be on PATH either way.
    const proc = oidc
        ? Bun.spawnSync(['npm', 'publish', ...(dryRun ? ['--dry-run'] : [])], {
            cwd: pkg.dir,
            env: process.env,
            stdout: 'inherit',
            stderr: 'inherit',
        })
        : Bun.spawnSync(['bun', 'publish', '--cwd', pkg.dir, ...(dryRun ? ['--dry-run'] : [])], {
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
