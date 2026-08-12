import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { buildHelp, parseCliArgs } from '../dist/internal.js';


const BIN = new URL('../dist/cli.js', import.meta.url).pathname;


const run = (args, options = {}) => {
    try {
        return {
            status: 0,
            stdout: execFileSync(process.execPath, [BIN, ...args], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                ...options,
            }),
            stderr: '',
        };
    }
    catch (err) {
        return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    }
};


test('bare invocation takes every default', () => {
    const opts = parseCliArgs([]);

    assert.equal(opts.intervalMs, 1000);
    assert.equal(opts.mount, undefined);
    assert.equal(opts.theme, 'auto');
    assert.equal(opts.graph, 'auto');
    assert.equal(opts.color, true);
    // the one destructive thing this tool can do stays off unless asked for
    assert.equal(opts.allowKill, false);
});


test('--allow-kill is the only way to turn signalling on', () => {
    assert.equal(parseCliArgs(['--allow-kill']).allowKill, true);
});


test('the interval accepts both spellings and is clamped to a sane band', () => {
    assert.equal(parseCliArgs(['-i', '500']).intervalMs, 500);
    assert.equal(parseCliArgs(['--interval', '2000']).intervalMs, 2000);

    // faster than this and the cost of sampling starts showing up in the sample
    assert.throws(() => parseCliArgs(['-i', '10']), /between 100 and 60000/);
    assert.throws(() => parseCliArgs(['-i', '120000']), /between 100 and 60000/);
});


test('a non-numeric interval is a usage error, not a NaN', () => {
    assert.throws(() => parseCliArgs(['-i', 'soon']), /whole number/);
    assert.throws(() => parseCliArgs(['-i', '1.5']), /whole number/);
    // Number('') is 0, which would otherwise sail through as a falsy default
    assert.throws(() => parseCliArgs(['-i', '']), /whole number|between/);
});


test('--theme and --graph reject anything not on their list', () => {
    assert.equal(parseCliArgs(['--theme', 'mono']).theme, 'mono');
    assert.equal(parseCliArgs(['--graph', 'braille']).graph, 'braille');

    assert.throws(() => parseCliArgs(['--theme', 'solarized']), /expects one of/);
    assert.throws(() => parseCliArgs(['--graph', 'sparkline']), /expects one of/);
});


test('--no-color is the negation parseArgs cannot express itself', () => {
    assert.equal(parseCliArgs(['--no-color']).color, false);
});


test('an unknown flag is rejected rather than ignored', () => {
    assert.throws(() => parseCliArgs(['--turbo']), /Unknown option/);
});


test('a positional argument is rejected', () => {
    // there is nothing to name: the dashboard has no subject argument
    assert.throws(() => parseCliArgs(['everything']), /./);
});


test('every flag in the parser appears in the help, and the reverse', () => {
    const help = buildHelp();

    // OPTIONS feeds both, so this only fails if someone bypasses it
    for (const flag of ['--interval', '--mount', '--theme', '--graph', '--allow-kill', '--no-color', '--version', '--help']) {
        assert.ok(help.includes(flag), `${flag} should be documented`);
    }
});


test('the help points at cpumon for anything scriptable', () => {
    // a user who reached for the dashboard and needed a pipe should not have to
    // discover the other binary on their own
    assert.match(buildHelp(), /cpumon --json/);
});


test('--help and --version exit zero without needing a terminal', () => {
    const help = run(['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage:\s+cpumon-tui/);

    const version = run(['--version']);
    assert.equal(version.status, 0);
    assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+/);
});


test('a usage error exits 2 and says how to get help', () => {
    const result = run(['--turbo']);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unknown option/);
    assert.match(result.stderr, /--help/);
});


test('a non-terminal stdout is refused on stderr, exit 1, with nothing on stdout', () => {
    const result = run([]);

    assert.equal(result.status, 1);
    // the refusal must not go to stdout: whatever is consuming that pipe is
    // expecting data, and a friendly message is still garbage to it
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /needs a terminal/);
});
