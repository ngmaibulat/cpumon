/**
 * Handing the terminal to an editor.
 *
 * Two halves, split the way everything else in this package is: `resolveEditor`
 * decides and is pure, `runEditor` does it and is the only part that spawns.
 *
 * The fallback chain is deliberate and is a departure from the usual advice of
 * "respect $EDITOR or refuse". On a machine where neither $VISUAL nor $EDITOR is
 * set - which is the default on a fresh install, and is the case on the machine
 * this was written for - refusing means the key does nothing and the user is
 * told to go and configure a shell variable. Opening the editor they almost
 * certainly have is what was actually asked for. $VISUAL and $EDITOR still win
 * whenever they are set, which is the part that matters.
 */

import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';


export type Editor = {
    command: string;
    args: string[];
};


/** tried in order when the environment says nothing */
export const EDITOR_FALLBACKS = ['nvim', 'vim', 'hx', 'helix', 'vi'];


export type ResolveOptions = {
    /** test seam: is this name on the PATH */
    exists?: (path: string) => boolean;
};


function onPath(env: NodeJS.ProcessEnv, exists: (path: string) => boolean, name: string): boolean
{
    for (const dir of (env.PATH ?? '').split(delimiter)) {
        if (dir !== '' && exists(join(dir, name))) {
            return true;
        }
    }

    return false;
}


const executable = (path: string): boolean => {
    try {
        accessSync(path, constants.X_OK);

        return true;
    }
    catch {
        return false;
    }
};


/**
 * Which editor to run.
 *
 * The value is split on whitespace so `EDITOR="code -w"` works - the wait flag
 * is not optional for an editor that would otherwise return immediately and let
 * the dashboard redraw over it. A configured editor is taken at its word and is
 * not checked against the PATH: if it is wrong, `runEditor` reports the ENOENT,
 * which is a better message than "no editor found".
 */
export function resolveEditor(env: NodeJS.ProcessEnv = process.env, options: ResolveOptions = {}): Editor | null
{
    for (const name of ['VISUAL', 'EDITOR']) {
        const value = env[name]?.trim();

        if (value !== undefined && value !== '') {
            const [command, ...args] = value.split(/\s+/);

            return { command: command!, args };
        }
    }

    const exists = options.exists ?? executable;

    for (const candidate of EDITOR_FALLBACKS) {
        if (onPath(env, exists, candidate)) {
            return { command: candidate, args: [] };
        }
    }

    return null;
}


export type EditorResult = {
    ok: boolean;
    message: string;
};


export type EditorSpawner = typeof spawn;


/**
 * Run it, and wait.
 *
 * `stdio: 'inherit'` because the editor needs the real terminal - its own
 * alternate screen, its own raw mode, its own idea of the cursor. `detached:
 * false` because it has to stay in this process group to be the terminal's
 * foreground job; a detached child earns SIGTTIN the moment it reads a key.
 *
 * Resolves rather than rejects on failure. A misspelled $EDITOR is a footer
 * message, not an exception that unwinds through a suspended terminal.
 */
export function runEditor(
    path: string,
    editor: Editor,
    spawner: EditorSpawner = spawn,
): Promise<EditorResult>
{
    return new Promise(resolve => {
        let child;

        try {
            child = spawner(editor.command, [...editor.args, path], {
                stdio: 'inherit',
                detached: false,
            });
        }
        catch (err) {
            resolve({ ok: false, message: `could not run ${editor.command}: ${(err as Error).message}` });

            return;
        }

        let settled = false;

        const done = (result: EditorResult) => {
            if (!settled) {
                settled = true;
                resolve(result);
            }
        };

        child.on('error', (err: Error) => {
            done({ ok: false, message: `could not run ${editor.command}: ${err.message}` });
        });

        child.on('exit', (code: number | null) => {
            done(code === 0 || code === null
                ? { ok: true, message: `edited ${path}` }
                : { ok: false, message: `${editor.command} exited ${code}` });
        });
    });
}
