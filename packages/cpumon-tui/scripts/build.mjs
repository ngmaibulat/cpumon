// Build driver for src/ -> dist/.
//
// Deliberately unlike the parent package's build, in two ways.
//
// It bundles. cpumon is a library, so its bin/ mirrors src/ one-to-one and each
// module keeps its own .d.ts. cpumon-tui is an application: nothing downstream
// resolves an individual module of it, so a bundle is simpler and starts faster.
//
// node_modules stays external, though. Bundling ink would drag yoga-layout's
// wasm through esbuild's loaders for no benefit, and react-devtools-core is an
// optional dynamic require that esbuild cannot statically satisfy.

import * as esbuild from 'esbuild';

const options = {
    // cli.tsx carries the shebang, index.ts is the programmatic entry, and
    // internal.ts is the test surface - a real entry point because splitting
    // gives the shared chunks content-hashed names a test cannot import
    entryPoints: ['src/index.ts', 'src/cli.tsx', 'src/internal.ts'],
    outbase: 'src',
    outdir: 'dist',
    bundle: true,
    // ink / react / cpumon resolve from node_modules at runtime
    packages: 'external',
    // the two entries share nearly all their code; without this it is emitted
    // into both files
    splitting: true,
    format: 'esm',
    // matches "engines": { "node": ">=22" }, which is ink 7's floor
    target: 'node22',
    platform: 'node',
    jsx: 'automatic',
    jsxImportSource: 'react',
    loader: { '.tsx': 'tsx', '.ts': 'ts' },
    logLevel: 'info',
};

if (process.argv.includes('--watch')) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
}
else {
    await esbuild.build(options);
}
