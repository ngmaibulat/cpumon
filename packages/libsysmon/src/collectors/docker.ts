/**
 * Containers and compose stacks, from the Docker Engine API.
 *
 * The socket at /var/run/docker.sock speaks plain HTTP, so this needs no
 * dependency - `node:http` takes a `socketPath` and the rest is an ordinary
 * request. No `docker ps`, for the reason recorded in plans/README.md: a
 * subprocess per refresh is both a cost and a parsing contract that drifts
 * between tool versions, and this one is a documented wire format.
 *
 * This is the first ASYNCHRONOUS collector in the package, and that is a real
 * distinction rather than an implementation detail. Every other collector here
 * reads a memory-backed pseudo-file and returns; SystemMonitor can call them on
 * a timer and stay synchronous. A socket round-trip to a daemon that might be
 * busy cannot go on that path without making the render loop stutter, so this
 * one is a Promise and the application schedules it separately.
 *
 * ## Compose is a label convention
 *
 * There is no compose daemon and no compose API. A "stack" is a set of
 * containers that agree on `com.docker.compose.project`, and the folder is
 * another label beside it. That is the entire model, which is why
 * groupIntoStacks() is twenty lines rather than a client of anything.
 */

import { request } from 'node:http';

import { unavailable } from '../types.js';
import type { Probe, Unavailable } from '../types.js';
import { checkUnixSocket } from './socket.js';


export type DockerPort = {
    ip?: string;
    privatePort: number;
    publicPort?: number;
    type: string;
};


/**
 * Which compose project a container belongs to.
 *
 * Absent, not defaulted: a container started by hand with `docker run` is not a
 * one-service stack, it is simply not part of one. Inventing a project named
 * after it would put it on the stacks screen, where it does not belong.
 */
export type ComposeMembership = {
    project: string;
    service: string;
    containerNumber: number;
    workingDir?: string;
    configFiles?: string[];
    /** a `docker compose run` container rather than a declared service */
    oneoff: boolean;
};


export type DockerContainer = {
    /** full 64-hex; the panel shortens it with format.shortId */
    id: string;
    /** Names[0] with its leading slash stripped */
    name: string;
    image: string;
    command: string;
    /** seconds since epoch, as the API gives it */
    createdAt: number;
    /** 'running' | 'exited' | 'paused' | ... */
    state: string;
    /** the human string, 'Up 3 days' */
    status: string;
    ports: DockerPort[];
    labels: Record<string, string>;
    compose?: ComposeMembership;
};


export type ComposeStack = {
    project: string;
    workingDir?: string;
    configFiles: string[];
    services: DockerContainer[];
    /** counts, so a row can say "11/13 up" without the panel recomputing it */
    running: number;
    total: number;
};


export type DockerOptions = {
    socketPath?: string;
    apiVersion?: string;
    timeoutMs?: number;
};


export const DEFAULT_DOCKER_SOCKET = '/var/run/docker.sock';

/**
 * Old enough that every daemon still in service accepts it.
 *
 * The engine reports a MinAPIVersion it will honour - 1.40 on a current build -
 * and asking for a version above the daemon's own is a 400. Asking for an old
 * one costs nothing here, because every field this collector reads has been in
 * the container list since long before 1.43.
 */
export const DEFAULT_DOCKER_API = 'v1.43';

const LABEL = {
    project: 'com.docker.compose.project',
    service: 'com.docker.compose.service',
    number: 'com.docker.compose.container-number',
    workingDir: 'com.docker.compose.project.working_dir',
    configFiles: 'com.docker.compose.project.config_files',
    oneoff: 'com.docker.compose.oneoff',
} as const;


function text(value: unknown): string
{
    return typeof value === 'string' ? value : '';
}


function toLabels(value: unknown): Record<string, string>
{
    if (value === null || typeof value !== 'object') {
        return {};
    }

    const labels: Record<string, string> = {};

    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        if (typeof raw === 'string') {
            labels[key] = raw;
        }
    }

    return labels;
}


function toPorts(value: unknown): DockerPort[]
{
    if (!Array.isArray(value)) {
        return [];
    }

    const ports: DockerPort[] = [];

    for (const entry of value) {
        if (entry === null || typeof entry !== 'object') {
            continue;
        }

        const item = entry as Record<string, unknown>;
        const privatePort = Number(item.PrivatePort);

        if (!Number.isFinite(privatePort)) {
            continue;
        }

        const publicPort = Number(item.PublicPort);
        const ip = text(item.IP);

        ports.push({
            privatePort,
            type: text(item.Type) || 'tcp',
            ...(ip === '' ? {} : { ip }),
            ...(Number.isFinite(publicPort) && publicPort > 0 ? { publicPort } : {}),
        });
    }

    return ports;
}


/**
 * Read the compose labels, if this container carries a complete set.
 *
 * A project with no service name is not a membership this can describe, so it
 * is dropped rather than half-filled - the stacks screen groups on both.
 */
export function composeOf(labels: Record<string, string>): ComposeMembership | undefined
{
    const project = labels[LABEL.project] ?? '';
    const service = labels[LABEL.service] ?? '';

    if (project === '' || service === '') {
        return undefined;
    }

    const number = Number(labels[LABEL.number]);
    const workingDir = labels[LABEL.workingDir] ?? '';
    const configFiles = labels[LABEL.configFiles] ?? '';

    return {
        project,
        service,
        containerNumber: Number.isFinite(number) && number > 0 ? number : 1,
        ...(workingDir === '' ? {} : { workingDir }),
        ...(configFiles === '' ? {} : { configFiles: configFiles.split(',').filter(item => item !== '') }),
        // the label is the literal string 'True' or 'False', not a JSON boolean
        oneoff: labels[LABEL.oneoff]?.toLowerCase() === 'true',
    };
}


/**
 * Turn the parsed body of GET /containers/json into rows.
 *
 * Pure, and exported, so the tests run against a recorded fixture on a machine
 * with no docker - the same bargain every parseX() in this package makes.
 */
export function parseDockerContainers(body: unknown): DockerContainer[]
{
    if (!Array.isArray(body)) {
        return [];
    }

    const containers: DockerContainer[] = [];

    for (const entry of body) {
        if (entry === null || typeof entry !== 'object') {
            continue;
        }

        const item = entry as Record<string, unknown>;
        const id = text(item.Id);

        // an entry with no id is not a container this can talk about: the id is
        // what joins it to a cgroup, and every consumer keys on it
        if (id === '') {
            continue;
        }

        const names = Array.isArray(item.Names) ? item.Names : [];
        const labels = toLabels(item.Labels);
        const compose = composeOf(labels);
        const createdAt = Number(item.Created);

        containers.push({
            id,
            // the API returns '/name'; the slash is a legacy of docker's old
            // link namespace and is noise in every column it would appear in
            name: text(names[0]).replace(/^\//, ''),
            image: text(item.Image),
            command: text(item.Command),
            createdAt: Number.isFinite(createdAt) ? createdAt : 0,
            state: text(item.State),
            status: text(item.Status),
            ports: toPorts(item.Ports),
            labels,
            ...(compose === undefined ? {} : { compose }),
        });
    }

    return containers;
}


/**
 * Group containers into compose projects.
 *
 * Containers with no project membership are left out entirely rather than
 * gathered into a synthetic stack. They are not stacks of one; they belong on
 * the containers screen.
 *
 * `running`/`total` deliberately exclude one-off containers. A `docker compose
 * run` shell counted as a service would make a healthy stack read "11/14 up"
 * for as long as somebody left the shell open - a number that is wrong about
 * the thing the column exists to say. The one-off rows are still returned so a
 * panel can show them; they are just not part of the count.
 */
export function groupIntoStacks(containers: DockerContainer[]): ComposeStack[]
{
    const stacks = new Map<string, ComposeStack>();

    for (const container of containers) {
        const compose = container.compose;

        if (compose === undefined) {
            continue;
        }

        let stack = stacks.get(compose.project);

        if (stack === undefined) {
            stack = {
                project: compose.project,
                ...(compose.workingDir === undefined ? {} : { workingDir: compose.workingDir }),
                configFiles: compose.configFiles ?? [],
                services: [],
                running: 0,
                total: 0,
            };

            stacks.set(compose.project, stack);
        }

        // the first member that carries a folder names it: compose writes the
        // same value onto every container of a project, and a later member
        // without one is missing the label, not contradicting it
        if (stack.workingDir === undefined && compose.workingDir !== undefined) {
            stack.workingDir = compose.workingDir;
        }

        if (stack.configFiles.length === 0 && compose.configFiles !== undefined) {
            stack.configFiles = compose.configFiles;
        }

        stack.services.push(container);

        if (!compose.oneoff) {
            stack.total++;

            if (container.state === 'running') {
                stack.running++;
            }
        }
    }

    for (const stack of stacks.values()) {
        stack.services.sort((a, b) => {
            const byService = (a.compose?.service ?? '').localeCompare(b.compose?.service ?? '');

            return byService !== 0
                ? byService
                : (a.compose?.containerNumber ?? 0) - (b.compose?.containerNumber ?? 0);
        });
    }

    return [...stacks.values()].sort((a, b) => a.project.localeCompare(b.project));
}


/**
 * GET a path from the engine socket.
 *
 * Resolves an Unavailable rather than rejecting, for the same reason the
 * synchronous readers never throw - and with more at stake, because an
 * unhandled rejection takes the process down with the alternate screen still
 * on the user's terminal.
 */
function get(path: string, socketPath: string, timeoutMs: number): Promise<{ ok: true; body: string } | ({ ok: false } & Unavailable)>
{
    return new Promise(resolve => {
        // whatever happens first wins; a socket can both time out and error
        let done = false;

        const finish = (result: { ok: true; body: string } | ({ ok: false } & Unavailable)): void => {
            if (!done) {
                done = true;
                resolve(result);
            }
        };

        const req = request({ socketPath, path, method: 'GET', timeout: timeoutMs }, res => {
            const chunks: Buffer[] = [];

            res.on('data', (chunk: Buffer) => chunks.push(chunk));

            res.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                const status = res.statusCode ?? 0;

                if (status < 200 || status >= 300) {
                    finish({ ok: false, ...unavailable('parse-error', `${path}: HTTP ${status}`) });

                    return;
                }

                finish({ ok: true, body });
            });

            res.on('error', (err: Error) => {
                finish({ ok: false, ...unavailable('parse-error', `${path}: ${err.message}`) });
            });
        });

        req.on('timeout', () => {
            // destroy() fires 'error' with ECONNRESET afterwards, which `done`
            // swallows - the timeout is the honest reason, not the reset
            req.destroy();
            finish({ ok: false, ...unavailable('not-found', `${socketPath}: no answer in ${timeoutMs}ms; is the daemon running?`) });
        });

        // checkUnixSocket() has already ruled on the path itself, so a failure here
        // is the daemon rather than the socket file - it exists, it is a socket
        // and it is writable, and still nothing answered
        req.on('error', (err: Error) => {
            finish({ ok: false, ...unavailable('not-found', `${socketPath}: ${err.message}`) });
        });

        req.end();
    });
}


/**
 * Every container the daemon knows about, running or not.
 *
 * `all=1` because a stack with a crashed service is precisely when someone
 * opens this screen, and a list that silently omits the exited container
 * answers the question wrongly.
 *
 * No platform guard. Docker's socket is not a kernel interface - Docker Desktop
 * exposes the same path on macOS - so reporting 'unsupported-platform' off
 * Linux would be a claim this cannot support. A machine without docker gets
 * ENOENT and therefore 'not-found', which is both true and more useful.
 */
export async function getDockerContainers(options?: DockerOptions): Promise<Probe<{ containers: DockerContainer[] }>>
{
    const socketPath = options?.socketPath ?? DEFAULT_DOCKER_SOCKET;
    const apiVersion = options?.apiVersion ?? DEFAULT_DOCKER_API;
    const timeoutMs = options?.timeoutMs ?? 2000;

    const unusable = checkUnixSocket(socketPath, {
        missing: 'no docker socket',
        denied: 'not in the docker group?',
    });

    if (unusable !== null) {
        return unusable;
    }

    const result = await get(`/${apiVersion}/containers/json?all=1`, socketPath, timeoutMs);

    if (!result.ok) {
        return unavailable(result.reason, result.detail);
    }

    let body: unknown;

    try {
        body = JSON.parse(result.body);
    }
    catch {
        return unavailable('parse-error', 'the container list was not JSON');
    }

    if (!Array.isArray(body)) {
        return unavailable('parse-error', 'the container list was not an array');
    }

    return { available: true, containers: parseDockerContainers(body) };
}
