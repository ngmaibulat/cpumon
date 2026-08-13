#!/usr/bin/env node

/**
 * The `etop` binary.
 *
 * Thin by design, like libsysmon's own: parsing lives in cli-args.ts, everything
 * else behind runTui(). This is the only file in the package with a top-level
 * side effect, which is what lets a test import any other module freely.
 *
 * The file is .tsx rather than .ts purely so esbuild treats it as an entry
 * point that may contain JSX. It does not, yet - but the shebang has to lead
 * whichever file esbuild emits as the bin, and moving that later is the kind of
 * change that silently produces an unexecutable dist/cli.js.
 */

import { CliError, buildHelp, getVersion, parseCliArgs } from './cli-args.js';
import { runTui } from './index.js';


/** ink 7's floor, and npm only *warns* on an engines mismatch */
const MINIMUM_NODE = 22;


async function main(): Promise<number>
{
    const major = Number(process.versions.node.split('.')[0]);

    if (major < MINIMUM_NODE) {
        console.error(`etop: needs Node ${MINIMUM_NODE} or newer, found ${process.versions.node}`);
        console.error('  `cpumon --bars` works on Node 18 and up');

        return 1;
    }

    let opts;

    try {
        opts = parseCliArgs(process.argv.slice(2));
    }
    catch (err) {
        if (err instanceof CliError) {
            console.error(`etop: ${err.message}`);
            console.error("Try 'etop --help' for the list of options.");

            return err.exitCode;
        }

        throw err;
    }

    if (opts.help) {
        console.log(buildHelp());

        return 0;
    }

    if (opts.version) {
        console.log(getVersion());

        return 0;
    }

    return runTui(opts);
}


process.exit(await main());
