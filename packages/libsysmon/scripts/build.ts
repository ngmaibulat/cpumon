// Build driver for src/ -> bin/.
//
// Emit stays per-file rather than bundled: bin/ mirrors src/ one-to-one, which is
// what keeps the separately generated .d.ts files (see tsc-types.json) resolving
// against their matching .js.
//
// `external: ['*']` is how that is expressed to Bun, and the obvious spelling is
// wrong twice over. `bun build --no-bundle` is CLI-only - Bun.build has no such
// option - and it strips the `#!/usr/bin/env node` line off cpumon.ts, silently
// producing a bin/cpumon.js that npm marks executable and the kernel cannot run.
// Bundling mode keeps the shebang; externalising every specifier means nothing is
// actually inlined, so the output is still one file in, one file out.
//
// The walk lives here rather than in the script line because npm/bun scripts run
// under sh, where `src/*.ts` does not descend into directories - any file added
// under src/collectors/ would be silently never built.

import { Glob } from 'bun';
import { watch } from 'node:fs';
import { join } from 'node:path';

// anchored to this file rather than to the cwd, so the build is the same build
// wherever it is invoked from
const PKG = join(import.meta.dir, '..');
const SRC = join(PKG, 'src');
const OUT = join(PKG, 'bin');


async function build()
{
    // sorted so the build log is stable between runs
    const entrypoints = [...new Glob('**/*.ts').scanSync({ cwd: SRC })]
        .sort()
        .map((file) => `${SRC}/${file}`);

    // deliberately no rm -rf: `bun run build:types` writes the .d.ts files into
    // bin/ alongside their .js, and bin/ is committed. Bun.build leaves outdir
    // alone, which is what this package wants.
    const result = await Bun.build({
        entrypoints,
        // pin the output layout to src/ so a file's path in bin/ always mirrors
        // its path in src/, rather than shifting when the common ancestor changes
        root: SRC,
        outdir: OUT,
        format: 'esm',
        // Bun has no per-version target the way esbuild's 'node18' was; 'node'
        // is the whole of it, and the output is plain Node ESM either way
        target: 'node',
        external: ['*'],
        splitting: false,
        throw: true,
    });

    console.log(`built ${result.outputs.length} files into bin/`);
}


await build();

if (process.argv.includes('--watch')) {
    // `bun --watch run scripts/build.ts` would only watch what this file imports,
    // which is nothing under src/. Watch the tree directly instead.
    let pending: ReturnType<typeof setTimeout> | undefined;

    watch(SRC, { recursive: true }, () =>
    {
        clearTimeout(pending);
        pending = setTimeout(() => { build().catch(console.error); }, 50);
    });

    console.log('watching src/');
}
