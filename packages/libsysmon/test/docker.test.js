import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    composeOf,
    getDockerContainers,
    groupIntoStacks,
    parseDockerContainers,
} from '../bin/collectors/docker.js';
import { readFixture } from './helpers/fixtures.js';


const BODY = JSON.parse(readFixture('docker-containers.json'));

const containers = () => parseDockerContainers(BODY);

const stackOf = (project) => groupIntoStacks(containers()).find(s => s.project === project);


/** an http server on a unix socket, torn down by the caller */
async function serve(handler)
{
    const dir = mkdtempSync(join(tmpdir(), 'etop-docker-'));
    const socketPath = join(dir, 'docker.sock');
    const server = createServer(handler);

    await new Promise(resolve => server.listen(socketPath, resolve));

    return {
        socketPath,
        dispose: () => new Promise(resolve => server.close(() => {
            rmSync(dir, { recursive: true, force: true });
            resolve();
        })),
    };
}


test('the fixture parses into containers, one of which joins no project', () => {
    const parsed = containers();

    assert.equal(parsed.length, 6);
    assert.equal(parsed.filter(item => item.compose !== undefined).length, 5);

    const loose = parsed.find(item => item.compose === undefined);

    assert.equal(loose.name, 'hand-started-redis', 'the leading slash is stripped from Names[0]');
    assert.equal(loose.image, 'redis:7-alpine');
    assert.equal(loose.state, 'running');
});


test('a container started by hand is in no stack rather than a stack of one', () => {
    // it is not a one-service project; it belongs on the containers screen
    const stacks = groupIntoStacks(containers());

    assert.deepEqual(stacks.map(s => s.project), ['default-lab', 'mailgw']);

    const named = stacks.flatMap(s => s.services).map(s => s.name);

    assert.ok(!named.includes('hand-started-redis'), named.join(', '));
});


test('a one-off container is shown but not counted', () => {
    const stack = stackOf('default-lab');

    // four rows, three of them declared services
    assert.equal(stack.services.length, 4);
    assert.equal(stack.total, 3);
    assert.equal(stack.running, 3);

    const oneoff = stack.services.filter(s => s.compose.oneoff);

    assert.equal(oneoff.length, 1, 'the one-off row is still there to be shown');
    assert.equal(oneoff[0].state, 'running', 'and it is running, so it would have inflated the count');
});


test('a stack with no working_dir on any member still forms', () => {
    const stack = stackOf('mailgw');

    assert.equal(stack.workingDir, undefined);
    assert.deepEqual(stack.configFiles, []);
    assert.equal(stack.total, 1);
    assert.equal(stack.running, 0, 'its only service has exited');
});


test('one member missing the folder label does not lose the project its folder', () => {
    // compose writes working_dir onto every container of a project, so a member
    // without it is missing the label rather than contradicting the others
    const stack = stackOf('default-lab');

    assert.match(stack.workingDir, /siem-tracker/);
    assert.equal(stack.configFiles.length, 1);

    const redis = stack.services.find(s => s.compose.service === 'redis');

    assert.equal(redis.compose.workingDir, undefined, 'the fixture really does omit it on this one');
});


test('exited services count against the total but not the running figure', () => {
    const stack = stackOf('mailgw');

    assert.equal(`${stack.running}/${stack.total}`, '0/1');
});


test('compose membership needs both a project and a service', () => {
    assert.equal(composeOf({}), undefined);
    assert.equal(composeOf({ 'com.docker.compose.project': 'p' }), undefined);
    assert.equal(composeOf({ 'com.docker.compose.service': 's' }), undefined);

    const both = composeOf({ 'com.docker.compose.project': 'p', 'com.docker.compose.service': 's' });

    assert.equal(both.project, 'p');
    assert.equal(both.containerNumber, 1, 'a missing container-number is the first one');
    assert.equal(both.oneoff, false);
});


test('the oneoff label is the string True, not a boolean', () => {
    const base = { 'com.docker.compose.project': 'p', 'com.docker.compose.service': 's' };

    assert.equal(composeOf({ ...base, 'com.docker.compose.oneoff': 'True' }).oneoff, true);
    assert.equal(composeOf({ ...base, 'com.docker.compose.oneoff': 'true' }).oneoff, true);
    assert.equal(composeOf({ ...base, 'com.docker.compose.oneoff': 'False' }).oneoff, false);
    assert.equal(composeOf({ ...base }).oneoff, false);
});


test('config_files is a comma-separated label, not a list', () => {
    const membership = composeOf({
        'com.docker.compose.project': 'p',
        'com.docker.compose.service': 's',
        'com.docker.compose.project.config_files': '/a/docker-compose.yml,/a/override.yml',
    });

    assert.deepEqual(membership.configFiles, ['/a/docker-compose.yml', '/a/override.yml']);
});


test('ports keep the published mapping and drop the unpublished zero', () => {
    const nginx = containers().find(item => item.name === 'default-lab-nginx-1');

    assert.ok(nginx.ports.length > 0);
    assert.deepEqual(nginx.ports[0], { privatePort: 80, type: 'tcp', ip: '0.0.0.0', publicPort: 80 });

    const unpublished = parseDockerContainers([
        { Id: 'a'.repeat(64), Names: ['/x'], Ports: [{ PrivatePort: 5432, PublicPort: 0, Type: 'tcp' }] },
    ]);

    assert.deepEqual(unpublished[0].ports, [{ privatePort: 5432, type: 'tcp' }]);
});


test('a body that is not a list of containers yields no rows rather than throwing', () => {
    assert.deepEqual(parseDockerContainers(null), []);
    assert.deepEqual(parseDockerContainers({ message: 'page not found' }), []);
    assert.deepEqual(parseDockerContainers([null, 3, 'x']), []);

    // an entry with no Id cannot be joined to a cgroup or keyed on
    assert.deepEqual(parseDockerContainers([{ Names: ['/nameless'] }]), []);
});


test('a missing socket is not-found, because docker is not installed', async () => {
    const probe = await getDockerContainers({ socketPath: '/nonexistent/docker.sock', timeoutMs: 500 });

    assert.equal(probe.available, false);
    assert.equal(probe.reason, 'not-found');
    assert.match(probe.detail, /no docker socket/);
});


test('a socket that cannot be opened is permission-denied, not not-found', { skip: process.getuid?.() === 0 ? 'running as root' : false }, async () => {
    // the common case on a fresh machine: docker is installed and the user is
    // not in the docker group. Reporting it as "not installed" sends someone to
    // reinstall a package they already have.
    const dir = mkdtempSync(join(tmpdir(), 'etop-docker-'));
    const socketPath = join(dir, 'docker.sock');
    const server = createServer(() => {});

    await new Promise(resolve => server.listen(socketPath, resolve));
    chmodSync(socketPath, 0o000);

    try {
        const probe = await getDockerContainers({ socketPath, timeoutMs: 500 });

        assert.equal(probe.available, false);
        assert.equal(probe.reason, 'permission-denied');
        assert.match(probe.detail, /docker group/);
    }
    finally {
        await new Promise(resolve => server.close(resolve));
        rmSync(dir, { recursive: true, force: true });
    }
});


test('a non-2xx answer is a parse-error carrying the status', async () => {
    const { socketPath, dispose } = await serve((_req, res) => {
        res.writeHead(500);
        res.end('boom');
    });

    try {
        const probe = await getDockerContainers({ socketPath, timeoutMs: 1000 });

        assert.equal(probe.available, false);
        assert.equal(probe.reason, 'parse-error');
        assert.match(probe.detail, /HTTP 500/);
    }
    finally {
        await dispose();
    }
});


test('a body that is not JSON is a parse-error rather than a crash', async () => {
    const { socketPath, dispose } = await serve((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('<html>not json</html>');
    });

    try {
        const probe = await getDockerContainers({ socketPath, timeoutMs: 1000 });

        assert.equal(probe.available, false);
        assert.equal(probe.reason, 'parse-error');
        assert.match(probe.detail, /not JSON/);
    }
    finally {
        await dispose();
    }
});


test('a daemon that never answers times out rather than hanging the caller', async () => {
    const { socketPath, dispose } = await serve(() => {
        // deliberately never responds
    });

    try {
        const probe = await getDockerContainers({ socketPath, timeoutMs: 250 });

        assert.equal(probe.available, false);
        assert.equal(probe.reason, 'not-found');
        assert.match(probe.detail, /no answer/);
    }
    finally {
        await dispose();
    }
});


test('a good answer round-trips through the socket', async () => {
    const { socketPath, dispose } = await serve((req, res) => {
        assert.match(req.url, /^\/v1\.43\/containers\/json\?all=1$/, 'all=1 or a crashed service vanishes');

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(BODY));
    });

    try {
        const probe = await getDockerContainers({ socketPath, timeoutMs: 1000 });

        assert.equal(probe.available, true);
        assert.equal(probe.containers.length, 6);
        assert.equal(groupIntoStacks(probe.containers).length, 2);
    }
    finally {
        await dispose();
    }
});


test('getDockerContainers resolves an Unavailable and never rejects', async () => {
    // an unhandled rejection takes the process down with the alternate screen
    // still on the user's terminal, so this is the whole contract
    const results = await Promise.all([
        getDockerContainers({ socketPath: '/nonexistent/a.sock', timeoutMs: 200 }),
        getDockerContainers({ socketPath: '/nonexistent/b.sock', timeoutMs: 200 }),
    ]);

    for (const probe of results) {
        assert.equal(probe.available, false);
        assert.equal(typeof probe.reason, 'string');
    }
});
