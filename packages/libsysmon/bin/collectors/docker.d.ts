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
import type { Probe } from '../types.js';
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
export declare const DEFAULT_DOCKER_SOCKET = "/var/run/docker.sock";
/**
 * Old enough that every daemon still in service accepts it.
 *
 * The engine reports a MinAPIVersion it will honour - 1.40 on a current build -
 * and asking for a version above the daemon's own is a 400. Asking for an old
 * one costs nothing here, because every field this collector reads has been in
 * the container list since long before 1.43.
 */
export declare const DEFAULT_DOCKER_API = "v1.43";
/**
 * Read the compose labels, if this container carries a complete set.
 *
 * A project with no service name is not a membership this can describe, so it
 * is dropped rather than half-filled - the stacks screen groups on both.
 */
export declare function composeOf(labels: Record<string, string>): ComposeMembership | undefined;
/**
 * Turn the parsed body of GET /containers/json into rows.
 *
 * Pure, and exported, so the tests run against a recorded fixture on a machine
 * with no docker - the same bargain every parseX() in this package makes.
 */
export declare function parseDockerContainers(body: unknown): DockerContainer[];
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
export declare function groupIntoStacks(containers: DockerContainer[]): ComposeStack[];
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
export declare function getDockerContainers(options?: DockerOptions): Promise<Probe<{
    containers: DockerContainer[];
}>>;
