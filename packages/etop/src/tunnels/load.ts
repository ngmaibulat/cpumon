/**
 * Reading the config off disk, and writing the first one.
 *
 * Deliberately thin: everything that decides anything lives in config.ts, and
 * this file does the two things that touch the filesystem. That is the same
 * split `libsysmon/collectors/proc.ts` already insists on - readers never
 * parse and parsers never read - and it is why the parser's tests need no
 * fixture tree at all.
 *
 * Failure is a Probe rather than an exception, for the reason `types.ts` in
 * libsysmon gives: one missing file must not be fatal to a whole dashboard.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { unavailable } from 'libsysmon';
import type { Probe } from 'libsysmon';

import { TEMPLATE, configPath, parseTunnelConfig } from './config.js';
import type { TunnelConfig } from './config.js';


export type ConfigProbe = Probe<{ config: TunnelConfig; path: string }>;


/**
 * The config, or why there isn't one.
 *
 * Never throws. The three outcomes a caller has to tell apart:
 *
 * - `not-found` is not a failure. It is a user who has not written one yet, and
 *   the panel offers to create it rather than complaining.
 * - `permission-denied` keeps its own reason because it is actionable and is
 *   not the same thing as absent.
 * - `parse-error` carries every complaint the validator made, joined. The panel
 *   shows the first couple; the CLI prints all of them.
 */
export function loadTunnelConfig(path: string = configPath()): ConfigProbe
{
    let text: string;

    try {
        text = readFileSync(path, 'utf8');
    }
    catch (err) {
        const code = (err as NodeJS.ErrnoException).code;

        if (code === 'ENOENT') {
            return unavailable('not-found', path);
        }

        if (code === 'EACCES' || code === 'EPERM') {
            return unavailable('permission-denied', path);
        }

        return unavailable('parse-error', `${path}: ${(err as Error).message}`);
    }

    const result = parseTunnelConfig(text);

    if (!result.ok) {
        return unavailable('parse-error', result.errors.join('\n'));
    }

    return { available: true, config: result.config, path };
}


export type WriteResult = {
    ok: boolean;
    /** one line, for the footer */
    message: string;
};


/**
 * Write the starter config, if and only if there isn't one.
 *
 * This is the only file etop ever writes, so it is the only place in the
 * package that can destroy something the user made. `wx` is what makes that
 * impossible: the flag fails with EEXIST rather than truncating, and the check
 * is the open itself rather than a stat followed by a write - which is a race,
 * and the race loses the file.
 *
 * The directory is created 0o700 because a tunnel config names hosts and
 * usernames and sometimes a key path, which is nobody else's business.
 */
export function writeTemplate(path: string = configPath()): WriteResult
{
    try {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        writeFileSync(path, TEMPLATE, { flag: 'wx', mode: 0o600 });

        return { ok: true, message: `wrote ${path}` };
    }
    catch (err) {
        const code = (err as NodeJS.ErrnoException).code;

        if (code === 'EEXIST') {
            return { ok: false, message: `${path} already exists` };
        }

        return { ok: false, message: `could not write ${path}: ${(err as Error).message}` };
    }
}
