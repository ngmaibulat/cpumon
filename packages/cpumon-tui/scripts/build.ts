// Build driver for src/ -> dist/.
//
// Deliberately unlike the parent package's build, in two ways.
//
// It bundles. cpumon is a library, so its bin/ mirrors src/ one-to-one and each
// module keeps its own .d.ts. cpumon-tui is an application: nothing downstream
// resolves an individual module of it, so a bundle is simpler and starts faster.
//
// node_modules stays external, though. Bundling ink would drag yoga-layout's
// wasm through the loaders for no benefit, and react-devtools-core is an
// optional dynamic require that no bundler can statically satisfy.

import { rmSync, watch } from 'node:fs';

const SRC = 'src';
const OUT = 'dist';


async function build()
{
    // Splitting gives the shared chunks content-hashed names, so every build leaves
    // the previous build's chunks behind. Nothing imports them and nothing notices
    // - until `bun pm pack` ships a tarball five times the size of the code in it.
    // Bun.build does not clean outdir either, so this stays.
    rmSync(OUT, { recursive: true, force: true });

    const result = await Bun.build({
        // cli.tsx carries the shebang, index.ts is the programmatic entry, and
        // internal.ts is the test surface - a real entry point because splitting
        // gives the shared chunks content-hashed names a test cannot import
        entrypoints: [`${SRC}/index.ts`, `${SRC}/cli.tsx`, `${SRC}/internal.ts`],
        root: SRC,
        outdir: OUT,
        format: 'esm',
        // matches "engines": { "node": ">=22" }, which is ink 7's floor. Bun takes
        // no version here; the output is plain Node ESM.
        target: 'node',
        // ink / react / cpumon resolve from node_modules at runtime
        packages: 'external',
        // the entries share nearly all their code; without this it is emitted
        // into every one of them
        splitting: true,
        jsx: { runtime: 'automatic', importSource: 'react' },
        // Load-bearing, and not remotely obvious. Bun picks React's *development*
        // JSX runtime unless it can see process.env.NODE_ENV === "production"
        // through a define. Without this the tarball ships
        // `import { jsxDEV } from "react/jsx-dev-runtime"`, a module production
        // React builds do not provide. NODE_ENV in the environment does not do it.
        // Neither does `jsx: { development: false }` (accepted, then ignored), nor
        // the --define CLI flag, nor tsconfig's "jsx": "react-jsx". Only this.
        define: { 'process.env.NODE_ENV': JSON.stringify('production') },
        throw: true,
    });

    console.log(`built ${result.outputs.length} files into ${OUT}/`);
}


await build();

if (process.argv.includes('--watch')) {
    // see the note in cpumon's build.ts: bun --watch tracks imports, not src/
    let pending: ReturnType<typeof setTimeout> | undefined;

    watch(SRC, { recursive: true }, () =>
    {
        clearTimeout(pending);
        pending = setTimeout(() => { build().catch(console.error); }, 50);
    });

    console.log(`watching ${SRC}/`);
}
