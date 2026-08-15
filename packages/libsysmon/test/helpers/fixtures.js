/**
 * Paths into the package, anchored to this file rather than to the cwd.
 *
 * A test that says 'test/fixtures/proc' only resolves when the runner happens
 * to have been started from packages/libsysmon - which is what `bun run test`
 * does, and what an editor, a subdirectory or a root-level `bun test` does not.
 * Everything here goes through import.meta.url instead, so where the suite is
 * invoked from stops being part of its contract.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';


const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
const PACKAGE = fileURLToPath(new URL('../../', import.meta.url));


/**
 * Absolute path to a file or directory under test/fixtures.
 *
 * A string rather than a URL because the collectors take procRoot/sysfsRoot as
 * plain strings and hand them straight to node:fs. join() rather than plain
 * concatenation so that fixture('') is the directory itself, not a path with a
 * trailing separator that turns up doubled in an error message.
 */
export function fixture(rel)
{
    return join(FIXTURES, rel);
}


export function readFixture(rel)
{
    return readFileSync(fixture(rel), 'utf8');
}


/** Absolute path to a file under the package root - bin/cpumon.js, say. */
export function pkgFile(rel)
{
    return join(PACKAGE, rel);
}


/**
 * The same location as a file:// href, for interpolating into the source of a
 * `node --input-type=module --eval` child. A child resolves a relative
 * specifier against its own cwd, so the specifier has to carry the location.
 */
export function pkgUrl(rel)
{
    return new URL(`../../${rel}`, import.meta.url).href;
}
