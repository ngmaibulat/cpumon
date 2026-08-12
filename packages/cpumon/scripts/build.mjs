// Build driver for src/ -> bin/.
//
// This exists because the previous one-liner, `esbuild src/*.ts --outdir=bin`,
// leaned on the *shell* to expand the glob, and npm scripts run under sh where
// `*` does not descend into directories. Any file added under a src/ subdirectory
// was silently never built. The esbuild JS API takes an explicit entry point list,
// so the walk happens here instead.
//
// Emit stays per-file rather than bundled: bin/ mirrors src/ one-to-one, which is
// what keeps the separately generated .d.ts files (see tsc-types.json) resolving
// against their matching .js.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as esbuild from 'esbuild';

const SRC = 'src';
const OUT = 'bin';


function findSources(dir)
{
    const entries = readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const path = join(dir, entry.name);

        if (entry.isDirectory()) {
            files.push(...findSources(path));
        }
        else if (entry.name.endsWith('.ts')) {
            files.push(path);
        }
    }

    return files;
}


const watch = process.argv.includes('--watch');

const options = {
    entryPoints: findSources(SRC),
    // pin the output layout to src/ so a file's path in bin/ always mirrors its
    // path in src/, rather than shifting when the common ancestor changes
    outbase: SRC,
    outdir: OUT,
    format: 'esm',
    // matches "engines": { "node": ">=18" }. The old 'es2017' predated that and
    // silently emitted an empty `import.meta` - which cli.ts needs to locate
    // package.json - as a warning rather than an error
    target: 'node18',
    platform: 'node',
    logLevel: 'info',
};

if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
}
else {
    await esbuild.build(options);
}
