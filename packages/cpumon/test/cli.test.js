import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

import { OPTIONS, CliError, buildHelp, parseCliArgs } from '../bin/cli.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const BIN = 'bin/cpumon.js';


/** run the binary and return { status, stdout, stderr } without throwing */
function run(args)
{
    try {
        const stdout = execFileSync(process.execPath, [BIN, ...args], {
            cwd: process.cwd(),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        return { status: 0, stdout, stderr: '' };
    }
    catch (err) {
        return {
            status: err.status,
            stdout: err.stdout ?? '',
            stderr: err.stderr ?? '',
        };
    }
}


test('defaults with no arguments', () => {
    const opts = parseCliArgs([]);

    assert.equal(opts.intervalMs, 1000);
    assert.equal(opts.count, null);
    assert.equal(opts.mode, 'bars');
    assert.equal(opts.color, true);
    assert.equal(opts.help, false);
});


test('long and short forms agree', () => {
    assert.deepEqual(parseCliArgs(['--interval', '250']), parseCliArgs(['-i', '250']));
    assert.deepEqual(parseCliArgs(['--count', '3']), parseCliArgs(['-n', '3']));
    assert.deepEqual(parseCliArgs(['--overall']), parseCliArgs(['-o']));
});


test('view flags select a mode', () => {
    assert.equal(parseCliArgs(['--overall']).mode, 'overall');
    assert.equal(parseCliArgs(['--fetch']).mode, 'fetch');
    assert.equal(parseCliArgs([]).mode, 'bars');
});


test('every OPTIONS entry carrying a mode actually selects it', () => {
    // the exclusion set and the parser both derive from OPTIONS, so this covers
    // any view added later without the test needing to be edited
    for (const spec of OPTIONS.filter(opt => opt.mode !== undefined)) {
        assert.equal(parseCliArgs([`--${spec.long}`]).mode, spec.mode);
    }
});


test('--json is a format, not a view', () => {
    // 0.3.0 treated --json as a mode, which made "which metric" and "machine
    // readable" compete for one slot
    assert.equal(parseCliArgs([]).format, 'text');
    assert.equal(parseCliArgs(['--json']).format, 'json');
    // the default view is unchanged, so `cpumon --json` still emits CpuInfo[]
    assert.equal(parseCliArgs(['--json']).mode, 'bars');
});


test('--json composes with every view', () => {
    for (const spec of OPTIONS.filter(opt => opt.mode !== undefined)) {
        const opts = parseCliArgs([`--${spec.long}`, '--json']);

        assert.equal(opts.mode, spec.mode);
        assert.equal(opts.format, 'json');
    }
});


test('--fetch is a one-shot unless a count is given', () => {
    assert.equal(parseCliArgs(['--fetch']).count, 1);
    assert.equal(parseCliArgs(['--fetch', '-n', '3']).count, 3);
});


test('--no-color turns colour off', () => {
    assert.equal(parseCliArgs(['--no-color']).color, false);
});


test('numeric flags reject non-positive and non-numeric values', () => {
    for (const args of [['-i', '0'], ['-i', 'abc'], ['-i', '-5'], ['-i', '1.5'], ['-n', '0'], ['-n', '']]) {
        assert.throws(() => parseCliArgs(args), CliError, `expected ${args.join(' ')} to be rejected`);
    }
});


test('unknown flags and stray positionals are rejected', () => {
    assert.throws(() => parseCliArgs(['--bogus']), CliError);
    assert.throws(() => parseCliArgs(['nonsense']), CliError);
    // a value-taking flag with no value
    assert.throws(() => parseCliArgs(['--interval']), CliError);
});


test('view flags cannot be combined with each other', () => {
    const views = OPTIONS.filter(opt => opt.mode !== undefined);

    // pairwise over everything OPTIONS declares as a view, so a new one joins
    // the exclusion set automatically
    for (const a of views) {
        for (const b of views) {
            if (a !== b) {
                assert.throws(
                    () => parseCliArgs([`--${a.long}`, `--${b.long}`]),
                    CliError,
                    `expected --${a.long} --${b.long} to conflict`,
                );
            }
        }
    }
});


test('--mount and --top parse and validate', () => {
    assert.equal(parseCliArgs(['--mount', '/home']).mount, '/home');
    assert.equal(parseCliArgs(['--top', '25']).top, 25);
    assert.equal(parseCliArgs([]).top, 10);
    // the default mount is the current filesystem root, not a hardcoded slash
    assert.equal(parseCliArgs([]).mount, path.parse(process.cwd()).root);

    for (const args of [['--top', '0'], ['--top', 'abc'], ['--top', '-1']]) {
        assert.throws(() => parseCliArgs(args), CliError);
    }
});


test('--fetch --json emits one parseable snapshot', () => {
    // this pair exited 2 in 0.3.0, when --json was a mode
    const out = run(['--fetch', '--json', '-i', '100']);

    assert.equal(out.status, 0);

    const snapshot = JSON.parse(out.stdout);

    assert.equal(typeof snapshot.version, 'string');
    assert.equal(typeof snapshot.memory.total, 'number');
    assert.equal(snapshot.cpu.cores, snapshot.cpu.perCore.length);
    // probes are emitted verbatim so the schema is stable across platforms
    assert.equal(typeof snapshot.disk.available, 'boolean');
    assert.equal(typeof snapshot.loadavg.available, 'boolean');
});


test('--overall --json emits the aggregate object', () => {
    const out = run(['--overall', '--json', '-n', '1', '-i', '100']);

    assert.equal(out.status, 0);

    const overall = JSON.parse(out.stdout.trim());

    assert.equal(typeof overall.loadPercentage, 'number');
    // the aggregate, not the per-core array
    assert.ok(!Array.isArray(overall));
});


test('--json alone is unchanged from 0.3.0', () => {
    // still the bare CpuInfo[] array, so the documented jq recipe holds
    const out = run(['--json', '-n', '1', '-i', '100']);
    const sample = JSON.parse(out.stdout.trim());

    assert.ok(Array.isArray(sample));
    assert.equal(typeof sample[0].loadPercentage, 'number');
});


test('the no-window views answer without waiting an interval', () => {
    // there is nothing to diff, so `cpumon --mem` should be as quick as `free`.
    // a default 1000ms interval would show up here immediately
    for (const view of ['--mem', '--load', '--disk']) {
        const started = Date.now();
        const { status, stdout } = run([view]);

        assert.equal(status, 0, `${view} should exit 0`);
        assert.ok(stdout.trim().length > 0, `${view} printed nothing`);
        assert.ok(Date.now() - started < 900, `${view} waited for a sampling interval`);
    }
});


test('the no-window views emit parseable JSON on every platform', () => {
    for (const view of ['--mem', '--load', '--disk']) {
        const { status, stdout } = run([view, '--json']);

        assert.equal(status, 0);

        const value = JSON.parse(stdout);

        // memory is not a probe - it can always answer. the other two are, and
        // on a platform that cannot read them `available` is simply false
        if (view === '--mem') {
            assert.equal(typeof value.total, 'number');
            assert.ok(['meminfo', 'cgroup', 'os'].includes(value.source));
        }
        else {
            assert.equal(typeof value.available, 'boolean');
        }
    }
});


test('an unreadable mount is an answer, not a failure', () => {
    // exit 2 is reserved for usage errors; a path that does not exist is a
    // runtime fact the probe reports
    const { status, stdout } = run(['--disk', '--mount', '/definitely/not/a/mount']);

    assert.equal(status, 0);
    assert.match(stdout, /unavailable \(not-found\)/);
});


test('CliError carries exit code 2', () => {
    try {
        parseCliArgs(['--bogus']);
        assert.fail('should have thrown');
    }
    catch (err) {
        assert.ok(err instanceof CliError);
        assert.equal(err.exitCode, 2);
    }
});


test('help text documents every option', () => {
    const help = buildHelp();

    for (const opt of OPTIONS) {
        assert.ok(help.includes(`--${opt.long}`), `--${opt.long} missing from help`);

        if (opt.short !== undefined) {
            assert.ok(help.includes(`-${opt.short}, `), `-${opt.short} missing from help`);
        }
    }

    assert.ok(help.includes('Usage:'));
});


test('--help exits 0 and prints usage', () => {
    const { status, stdout } = run(['--help']);

    assert.equal(status, 0);
    assert.ok(stdout.includes('Usage:'));
    assert.ok(stdout.includes('--interval'));
});


test('--version prints the package version', () => {
    const { status, stdout } = run(['--version']);

    assert.equal(status, 0);
    assert.equal(stdout.trim(), pkg.version);
});


test('--json emits parseable samples and exits at --count', () => {
    const { status, stdout } = run(['--json', '-i', '50', '-n', '2']);

    assert.equal(status, 0);

    const lines = stdout.trim().split('\n');
    assert.equal(lines.length, 2);

    for (const line of lines) {
        const sample = JSON.parse(line);

        assert.ok(Array.isArray(sample));
        assert.ok(sample.length > 0);
        assert.equal(typeof sample[0].model, 'string');
        assert.equal(typeof sample[0].load, 'number');
        assert.equal(typeof sample[0].loadPercentage, 'number');
    }
});


test('--overall prints one line per sample', () => {
    const { status, stdout } = run(['--overall', '-i', '50', '-n', '2']);

    assert.equal(status, 0);
    assert.equal(stdout.trim().split('\n').length, 2);
});


test('--fetch prints one panel and exits', () => {
    const { status, stdout } = run(['--fetch', '-i', '50']);

    assert.equal(status, 0);
    assert.ok(stdout.includes('CPU'));
    assert.ok(stdout.includes('Cores'));
    assert.ok(stdout.includes('Uptime'));
    assert.ok(stdout.includes('cpumon'));
});


test('bar output does not clear the screen when piped', () => {
    // stdout is a pipe here, so console.clear() must not fire
    const { status, stdout } = run(['-i', '50', '-n', '1']);

    assert.equal(status, 0);
    assert.ok(!stdout.includes(String.fromCharCode(27) + '[2J'), 'clear sequence leaked into the pipe');
});


test('--no-color strips ANSI escapes', () => {
    const { status, stdout } = run(['--no-color', '-i', '50', '-n', '1']);

    assert.equal(status, 0);
    assert.ok(!stdout.includes(String.fromCharCode(27) + '['), 'escape sequence found in output');
});


test('a bad flag exits 2 with a message on stderr', () => {
    const { status, stderr } = run(['--bogus']);

    assert.equal(status, 2);
    assert.ok(stderr.includes('cpumon:'));
    assert.ok(stderr.includes('--help'));
});


test('an invalid interval exits 2', () => {
    const { status, stderr } = run(['-i', '0']);

    assert.equal(status, 2);
    assert.ok(stderr.includes('--interval'));
});
