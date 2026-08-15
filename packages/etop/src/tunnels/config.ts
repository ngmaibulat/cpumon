/**
 * The tunnel config: where it lives, and what a valid one says.
 *
 * This is the first thing in either package to read a file out of $HOME. Every
 * collector so far has read /proc, /sys or a socket - paths the machine decides.
 * This one is the user's, so the rules are different: a collector that finds a
 * malformed file has hit a kernel it does not understand and should say
 * 'parse-error' and move on, whereas a user who has left a trailing comma wants
 * to be told which line, in which tunnel, and what was expected instead.
 *
 * So validation collects *every* problem rather than stopping at the first, and
 * each message carries the path that produced it. Fixing four typos over four
 * edit-run cycles is the experience this avoids.
 *
 * Everything here is pure. `configPath` takes its environment as a parameter,
 * the same shape `dbus/address.ts` and `term/capabilities.ts` already use, so a
 * test never reads the real environment and never touches a real $HOME. The
 * file read itself lives in load.ts.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';


/**
 * One port forward.
 *
 * Normalised: whatever shape the JSON used, the rest of the code sees this.
 * `bind` is optional because omitting it is meaningful to ssh - a local forward
 * with no bind address listens on localhost only, which is the safe default and
 * the one the user's existing alias gets.
 */
export type Forward =
    | { kind: 'local'; bind?: string; port: number; host: string; hostPort: number }
    | { kind: 'remote'; bind?: string; port: number; host: string; hostPort: number }
    | { kind: 'dynamic'; bind?: string; port: number };


export type Tunnel = {
    /** the key it was declared under; carried here so a list of them is enough */
    name: string;
    host: string;
    user?: string;
    port?: number;
    /** start it as soon as etop does */
    autostart: boolean;
    identityFile?: string;
    forwards: Forward[];
    /** each becomes one `-o Key=Value`, and overrides a default of the same name */
    options: Record<string, string>;
    /** appended verbatim, after everything this file generates */
    extraArgs: string[];
};


export type TunnelConfig = {
    version: number;
    tunnels: Tunnel[];
};


/** what a parse produced: the config, or every reason it could not be one */
export type ParseResult =
    | { ok: true; config: TunnelConfig }
    | { ok: false; errors: string[] };


/** the only version this understands */
export const CONFIG_VERSION = 1;


const NAME_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;
const OPTION_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

const TUNNEL_KEYS = [
    'host', 'user', 'port', 'autostart', 'identityFile', 'forwards', 'options', 'extraArgs',
] as const;

const FORWARD_KINDS = ['local', 'remote', 'dynamic'] as const;


/**
 * Where the config lives.
 *
 * XDG, with the specified fallback. `XDG_CONFIG_HOME` is honoured only when it
 * is an absolute path, which is what the basedir spec says to do with a
 * relative one - ignore it - rather than resolving it against a cwd that has
 * nothing to do with the user's config.
 */
export function configPath(env: NodeJS.ProcessEnv = process.env): string
{
    const xdg = env.XDG_CONFIG_HOME;

    const base = xdg !== undefined && xdg.startsWith('/')
        ? xdg
        : join(env.HOME ?? homedir(), '.config');

    return join(base, 'etop', 'tunnels.json');
}


/**
 * What gets written when there is no config yet.
 *
 * JSON has no comments, so the documentation is a "//" key that the parser
 * ignores by name. That is a deliberate exception to "unknown keys are
 * rejected": the alternative is a template that the parser refuses to read,
 * which is the worst possible first impression. `parseTunnelConfig(TEMPLATE)`
 * succeeding is asserted by a test for exactly that reason.
 */
export const TEMPLATE = `{
    "//": [
        "etop tunnel config. One entry per tunnel, keyed by the name you want to see.",
        "forwards: 'local' is ssh -L, 'remote' is -R, 'dynamic' is -D.",
        "A local forward reads port:host:hostport, exactly as ssh spells it.",
        "Keys must be loaded in an ssh-agent: etop runs ssh with BatchMode=yes,",
        "so a passphrase prompt fails fast instead of hanging with nothing to type into."
    ],
    "version": 1,
    "tunnels": {
        "example": {
            "host": "example.com",
            "user": "root",
            "autostart": false,
            "forwards": [
                { "local": "3128:localhost:3128" }
            ]
        }
    }
}
`;


/**
 * Text in, config or a list of complaints out. Never throws.
 *
 * A throw here would reach the render tree, and a dashboard that dies because
 * its config file has a trailing comma is worse than one that says so in a
 * panel. The tests assert doesNotThrow on deliberately broken input.
 */
export function parseTunnelConfig(text: string): ParseResult
{
    let raw: unknown;

    try {
        raw = JSON.parse(text);
    }
    catch (err) {
        // node's message already carries the offset, which is the one piece of
        // information that makes a syntax error findable
        return { ok: false, errors: [`not valid JSON: ${(err as Error).message}`] };
    }

    return validate(raw);
}


function validate(raw: unknown): ParseResult
{
    const errors: string[] = [];

    if (!isPlainObject(raw)) {
        return { ok: false, errors: ['the config must be a JSON object'] };
    }

    for (const key of Object.keys(raw)) {
        if (key !== '//' && key !== 'version' && key !== 'tunnels') {
            errors.push(`${key}: not a known setting`);
        }
    }

    const version = raw.version ?? CONFIG_VERSION;

    if (typeof version !== 'number' || !Number.isInteger(version)) {
        errors.push('version: must be a whole number');
    }
    else if (version > CONFIG_VERSION) {
        // refusing is the point: a field this etop drops silently is a tunnel
        // that does not do what the file says it does
        errors.push(`version: this config is version ${version}, newer than the ${CONFIG_VERSION} this etop understands`);
    }

    const tunnels: Tunnel[] = [];
    const declared = raw.tunnels;

    if (declared === undefined) {
        errors.push('tunnels: required');
    }
    else if (!isPlainObject(declared)) {
        // an array is the likely mistake, and it loses the names
        errors.push('tunnels: must be an object keyed by tunnel name');
    }
    else {
        for (const [name, value] of Object.entries(declared)) {
            tunnels.push(...validateTunnel(name, value, errors));
        }
    }

    return errors.length > 0
        ? { ok: false, errors }
        : { ok: true, config: { version: CONFIG_VERSION, tunnels } };
}


/** returns the tunnel in a one-element array, or nothing if it did not survive */
function validateTunnel(name: string, value: unknown, errors: string[]): Tunnel[]
{
    const at = `tunnels.${name}`;
    const before = errors.length;

    if (!NAME_PATTERN.test(name)) {
        errors.push(`${at}: a tunnel name may only hold letters, digits, dot, dash and underscore`);
    }

    if (!isPlainObject(value)) {
        errors.push(`${at}: must be an object`);

        return [];
    }

    for (const key of Object.keys(value)) {
        if (!(TUNNEL_KEYS as readonly string[]).includes(key)) {
            errors.push(`${at}.${key}: not a known setting`);
        }
    }

    const host = requireWord(value.host, `${at}.host`, errors);
    const user = optionalWord(value.user, `${at}.user`, errors);
    const identityFile = optionalWord(value.identityFile, `${at}.identityFile`, errors);
    const port = optionalPort(value.port, `${at}.port`, errors);
    const autostart = optionalBoolean(value.autostart, `${at}.autostart`, errors);
    const forwards = validateForwards(value.forwards, `${at}.forwards`, errors);
    const options = validateOptions(value.options, `${at}.options`, errors);
    const extraArgs = validateExtraArgs(value.extraArgs, `${at}.extraArgs`, errors);

    if (errors.length > before || host === null) {
        return [];
    }

    const tunnel: Tunnel = { name, host, autostart, forwards, options, extraArgs };

    if (user !== null) {
        tunnel.user = user;
    }

    if (port !== null) {
        tunnel.port = port;
    }

    if (identityFile !== null) {
        tunnel.identityFile = expandHome(identityFile);
    }

    return [tunnel];
}


function validateForwards(value: unknown, at: string, errors: string[]): Forward[]
{
    if (value === undefined) {
        errors.push(`${at}: required`);

        return [];
    }

    if (!Array.isArray(value)) {
        errors.push(`${at}: must be an array`);

        return [];
    }

    if (value.length === 0) {
        // `ssh -N` with nothing forwarded holds a connection open and moves no
        // traffic, which is never what anyone meant to write down
        errors.push(`${at}: needs at least one forward`);

        return [];
    }

    const forwards: Forward[] = [];

    value.forEach((entry, i) => {
        const forward = validateForward(entry, `${at}[${i}]`, errors);

        if (forward !== null) {
            forwards.push(forward);
        }
    });

    return forwards;
}


function validateForward(value: unknown, at: string, errors: string[]): Forward | null
{
    if (!isPlainObject(value)) {
        errors.push(`${at}: must be an object like { "local": "3128:localhost:3128" }`);

        return null;
    }

    const kinds = FORWARD_KINDS.filter(kind => value[kind] !== undefined);

    for (const key of Object.keys(value)) {
        if (!(FORWARD_KINDS as readonly string[]).includes(key)) {
            errors.push(`${at}.${key}: not a known setting; expected local, remote or dynamic`);
        }
    }

    if (kinds.length === 0) {
        errors.push(`${at}: needs one of local, remote or dynamic`);

        return null;
    }

    if (kinds.length > 1) {
        // two kinds in one entry has no meaning; splitting them is what was meant
        errors.push(`${at}: names ${kinds.join(' and ')}; a forward is exactly one of them`);

        return null;
    }

    const kind = kinds[0]!;

    return parseForward(kind, value[kind], at, errors);
}


/**
 * A forward, in either shape.
 *
 * The string form is OpenSSH's own grammar, so `3128:localhost:3128` copied
 * straight out of a shell alias works. The object form exists for the one case
 * the string form cannot express unambiguously: an IPv6 bind address, where the
 * colons collide with the separator.
 */
export function parseForward(
    kind: (typeof FORWARD_KINDS)[number],
    value: unknown,
    at: string,
    errors: string[],
): Forward | null
{
    if (isPlainObject(value)) {
        return objectForward(kind, value, at, errors);
    }

    if (typeof value !== 'string') {
        errors.push(`${at}.${kind}: must be a string or an object`);

        return null;
    }

    const parts = value.split(':');

    if (parts.some(part => part.includes(' '))) {
        errors.push(`${at}.${kind}: "${value}" contains a space`);

        return null;
    }

    if (kind === 'dynamic') {
        if (parts.length === 1) {
            const port = toPort(parts[0]!, `${at}.dynamic`, errors);

            return port === null ? null : { kind, port };
        }

        if (parts.length === 2) {
            const port = toPort(parts[1]!, `${at}.dynamic`, errors);

            return port === null ? null : { kind, bind: parts[0]!, port };
        }

        errors.push(`${at}.dynamic: expected "port" or "bind:port", got "${value}"`);

        return null;
    }

    // 3 parts is port:host:hostport, 4 adds a leading bind address. More than
    // four means an IPv6 literal went in unbracketed, which this grammar cannot
    // disambiguate - so say so and name the fix rather than guessing.
    if (parts.length === 3 || parts.length === 4) {
        const [bind, port, host, hostPort] = parts.length === 4
            ? parts
            : [undefined, ...parts];

        const localPort = toPort(port!, `${at}.${kind}`, errors);
        const remotePort = toPort(hostPort!, `${at}.${kind}`, errors);

        if (host === undefined || host === '') {
            errors.push(`${at}.${kind}: "${value}" has an empty host`);

            return null;
        }

        if (localPort === null || remotePort === null) {
            return null;
        }

        return bind === undefined
            ? { kind, port: localPort, host, hostPort: remotePort }
            : { kind, bind, port: localPort, host, hostPort: remotePort };
    }

    if (parts.length > 4) {
        errors.push(
            `${at}.${kind}: "${value}" has too many colons; `
            + 'an IPv6 bind address needs the object form, { "port": …, "host": …, "hostPort": …, "bind": … }',
        );

        return null;
    }

    errors.push(`${at}.${kind}: expected "port:host:hostport", got "${value}"`);

    return null;
}


function objectForward(
    kind: (typeof FORWARD_KINDS)[number],
    value: Record<string, unknown>,
    at: string,
    errors: string[],
): Forward | null
{
    const where = `${at}.${kind}`;
    const port = requirePort(value.port, `${where}.port`, errors);
    const bind = optionalWord(value.bind, `${where}.bind`, errors);

    if (kind === 'dynamic') {
        if (port === null) {
            return null;
        }

        return bind === null ? { kind, port } : { kind, bind, port };
    }

    const host = requireWord(value.host, `${where}.host`, errors);
    const hostPort = requirePort(value.hostPort, `${where}.hostPort`, errors);

    if (port === null || host === null || hostPort === null) {
        return null;
    }

    return bind === null
        ? { kind, port, host, hostPort }
        : { kind, bind, port, host, hostPort };
}


function validateOptions(value: unknown, at: string, errors: string[]): Record<string, string>
{
    if (value === undefined) {
        return {};
    }

    if (!isPlainObject(value)) {
        errors.push(`${at}: must be an object of ssh options`);

        return {};
    }

    const options: Record<string, string> = {};

    for (const [key, raw] of Object.entries(value)) {
        if (!OPTION_KEY_PATTERN.test(key)) {
            errors.push(`${at}.${key}: not a valid ssh option name`);

            continue;
        }

        if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
            errors.push(`${at}.${key}: must be a string, number or boolean`);

            continue;
        }

        const text = String(raw);

        if (hasControlOrSpace(text)) {
            errors.push(`${at}.${key}: "${text}" contains whitespace`);

            continue;
        }

        options[key] = text;
    }

    return options;
}


function validateExtraArgs(value: unknown, at: string, errors: string[]): string[]
{
    if (value === undefined) {
        return [];
    }

    if (!Array.isArray(value)) {
        errors.push(`${at}: must be an array of strings`);

        return [];
    }

    const args: string[] = [];

    value.forEach((entry, i) => {
        if (typeof entry !== 'string') {
            errors.push(`${at}[${i}]: must be a string`);

            return;
        }

        args.push(entry);
    });

    return args;
}


/**
 * A required string with no whitespace in it.
 *
 * Nothing here is passed through a shell - spawn() is called without `shell`,
 * so an argument containing a space is one argument and cannot become two. The
 * check is not a shell-injection guard; it is that a hostname with a newline in
 * it is a config error whichever way you look at it, and catching it here means
 * the argv stays something a person can read in a log line.
 */
function requireWord(value: unknown, at: string, errors: string[]): string | null
{
    if (value === undefined) {
        errors.push(`${at}: required`);

        return null;
    }

    return optionalWord(value, at, errors);
}


function optionalWord(value: unknown, at: string, errors: string[]): string | null
{
    if (value === undefined) {
        return null;
    }

    if (typeof value !== 'string') {
        errors.push(`${at}: must be a string`);

        return null;
    }

    if (value === '') {
        errors.push(`${at}: must not be empty`);

        return null;
    }

    if (hasControlOrSpace(value)) {
        errors.push(`${at}: "${value}" contains whitespace`);

        return null;
    }

    return value;
}


function requirePort(value: unknown, at: string, errors: string[]): number | null
{
    if (value === undefined) {
        errors.push(`${at}: required`);

        return null;
    }

    return optionalPort(value, at, errors);
}


function optionalPort(value: unknown, at: string, errors: string[]): number | null
{
    if (value === undefined) {
        return null;
    }

    if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push(`${at}: must be a whole number`);

        return null;
    }

    if (value < 1 || value > 65535) {
        errors.push(`${at}: ${value} is not a port; expected 1-65535`);

        return null;
    }

    return value;
}


function optionalBoolean(value: unknown, at: string, errors: string[]): boolean
{
    if (value === undefined) {
        return false;
    }

    if (typeof value !== 'boolean') {
        errors.push(`${at}: must be true or false`);

        return false;
    }

    return value;
}


function toPort(text: string, at: string, errors: string[]): number | null
{
    if (!/^\d{1,5}$/.test(text)) {
        errors.push(`${at}: "${text}" is not a port number`);

        return null;
    }

    return optionalPort(Number(text), at, errors);
}


/**
 * `~/` at the front of an identity file.
 *
 * Only at the front, and only the bare `~` - `~user` is a shell feature that
 * needs a passwd lookup, and quietly resolving it to the wrong home would be
 * worse than leaving it for ssh to reject.
 */
function expandHome(path: string, home: string = homedir()): string
{
    return path === '~' || path.startsWith('~/') ? join(home, path.slice(1)) : path;
}


/**
 * Whitespace, or a control character.
 *
 * Nothing here is passed through a shell - spawn() is called without `shell`,
 * so an argument with a space in it stays one argument and cannot become two.
 * This is not an injection guard; it is that a hostname with a newline in it is
 * a config error whichever way you look at it, and rejecting it here keeps the
 * argv something a person can read back in a log line.
 *
 * Written as a code-point scan rather than a regex on purpose. The character
 * class this replaces held literal NUL and control bytes, which is what makes
 * git treat a source file as binary - the defect plans/01-screens.md already
 * records against test/keymap.test.js.
 */
function hasControlOrSpace(text: string): boolean
{
    for (const char of text) {
        const code = char.codePointAt(0) ?? 0;

        // 0x20 is the space itself; everything below it is C0; 0x7f is DEL
        if (code <= 0x20 || code === 0x7f) {
            return true;
        }
    }

    return false;
}


function isPlainObject(value: unknown): value is Record<string, unknown>
{
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
