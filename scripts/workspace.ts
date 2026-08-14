// Reading the workspace: what packages exist, and what depends on what.
//
// Shared by release.ts and bump.ts because the two have to agree. A bump that
// walks the workspace differently from the publisher is a bump that produces
// releases the publisher then refuses - and finding that out at publish time is
// finding it out late.

import { Glob } from 'bun';

export const ROOT = new URL('..', import.meta.url).pathname;

// Every bucket, not just `dependencies`: bump.ts rewrites internal ranges
// wherever they are declared, and a devDependency on a workspace package is
// still a range that can go stale.
export const DEP_FIELDS = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
] as const;

export type DepField = (typeof DEP_FIELDS)[number];

export type Pkg = {
    dir: string;
    name: string;
    version: string;
    private?: boolean;
} & Partial<Record<DepField, Record<string, string>>>;


// apps/ as well as packages/, even though nothing under apps/ is published: the
// docs sites are workspace members, so a range in one of them can name a package
// being bumped. Callers that only care about publishable packages filter on
// `private` themselves.
export async function readPackages(): Promise<Pkg[]>
{
    const found: Pkg[] = [];

    for (const rel of new Glob('{packages,apps}/*/package.json').scanSync({ cwd: ROOT })) {
        const manifest = await Bun.file(`${ROOT}${rel}`).json();
        found.push({ ...manifest, dir: `${ROOT}${rel.replace('/package.json', '')}` });
    }

    return found;
}


// Topological, not hardcoded: adding a third package should not quietly
// reintroduce the ordering bug this exists to prevent.
export function publishOrder(pkgs: Pkg[]): Pkg[]
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
