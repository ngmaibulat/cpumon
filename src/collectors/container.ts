/**
 * Container detection and per-container resource usage.
 *
 * Two things this collector will not do, both because they would be dishonest:
 *
 * It does not guess that it is in a container from the cgroup path alone when
 * the runtime leaves a marker file - /.dockerenv and /run/.containerenv are
 * checked first because they are unambiguous.
 *
 * It does not present an empty sibling list as "no other containers". Inside a
 * cgroup namespace - the normal case for Docker, Podman and Kubernetes -
 * /sys/fs/cgroup IS your own cgroup, and every other container is simply
 * invisible. That is reported as scope: 'namespaced' rather than as an empty
 * host. Enumerating siblings only works from the host side, and this says so.
 */

import { existsSync, readdirSync } from 'node:fs';

import { unavailable } from '../types.js';
import type { Probe } from '../types.js';
import {
    detectCgroupVersion,
    readCgroupCpu,
    readCgroupLimits,
    readSelfCgroup,
} from './cgroup.js';
import type { CgroupCpuStat, CgroupLimits, CgroupVersion } from './cgroup.js';
import { sysfsRoot } from './proc.js';
import type { CollectorOptions } from './proc.js';


export type ContainerRuntime = 'docker' | 'podman' | 'kubernetes' | 'lxc' | 'systemd' | 'unknown';


export type ContainerRuntimeInfo = {
    inContainer: boolean;
    runtime: ContainerRuntime;
    detail?: string;
};


export type ContainerInfo = {
    /** the cgroup leaf name; 'self' for this process's own cgroup */
    id: string;
    /** cgroup path relative to the mount root */
    path: string;
    version: CgroupVersion;
    runtime: ContainerRuntime;
    limits: CgroupLimits;
    cpu: CgroupCpuStat;
    /** filled in by diffContainerCpu over a sampling window */
    cpuPercentage?: number;
};


/** How each runtime spells itself inside a cgroup path. */
const PATH_MARKERS: [RegExp, ContainerRuntime][] = [
    [/kubepods/, 'kubernetes'],
    [/libpod-|libpod_/, 'podman'],
    [/docker[-/]/, 'docker'],
    [/lxc[./]/, 'lxc'],
    [/machine\.slice/, 'systemd'],
];


function runtimeFromPath(path: string): ContainerRuntime | null
{
    for (const [pattern, runtime] of PATH_MARKERS) {
        if (pattern.test(path)) {
            return runtime;
        }
    }

    return null;
}


/**
 * Whether this process is running inside a container, and under what.
 *
 * Marker files come first because they are definitive. The cgroup path is a
 * good second signal but not a first one: a systemd user session on a bare
 * host has a deeply nested cgroup path and is not a container.
 */
export function detectContainer(options?: CollectorOptions): Probe<ContainerRuntimeInfo>
{
    if (process.platform !== 'linux') {
        return unavailable('unsupported-platform', 'containers are a Linux concept');
    }

    if (existsSync('/.dockerenv')) {
        return { available: true, inContainer: true, runtime: 'docker', detail: '/.dockerenv' };
    }

    if (existsSync('/run/.containerenv')) {
        return { available: true, inContainer: true, runtime: 'podman', detail: '/run/.containerenv' };
    }

    if (process.env.KUBERNETES_SERVICE_HOST !== undefined) {
        return { available: true, inContainer: true, runtime: 'kubernetes', detail: 'KUBERNETES_SERVICE_HOST' };
    }

    const self = readSelfCgroup(options);

    if (!self.available) {
        return self;
    }

    const runtime = runtimeFromPath(self.path);

    if (runtime !== null) {
        return { available: true, inContainer: true, runtime, detail: self.path };
    }

    return { available: true, inContainer: false, runtime: 'unknown', detail: self.path };
}


/** This process's own cgroup, whether or not it is a container. */
export function getContainerInfo(options?: CollectorOptions): Probe<ContainerInfo>
{
    if (process.platform !== 'linux') {
        return unavailable('unsupported-platform', 'cgroups are a Linux concept');
    }

    const self = readSelfCgroup(options);

    if (!self.available) {
        return self;
    }

    const version = self.version;
    const dir = `${sysfsRoot(options)}${version === 2 ? self.path : ''}`;

    const limits = readCgroupLimits(dir, version);

    if (!limits.available) {
        return limits;
    }

    const cpu = readCgroupCpu(dir, version);

    if (!cpu.available) {
        return cpu;
    }

    const { available: _limitsFlag, ...limitValues } = limits;
    const { available: _cpuFlag, ...cpuValues } = cpu;

    // inside a cgroup namespace our own path is just "/", so the path tells us
    // nothing - detectContainer's marker files are what identify the runtime
    const detected = detectContainer(options);

    const runtime = runtimeFromPath(self.path)
        ?? (detected.available && detected.inContainer ? detected.runtime : 'unknown');

    return {
        available: true,
        id: self.path.split('/').filter(Boolean).pop() ?? 'self',
        path: self.path,
        version,
        runtime,
        limits: limitValues,
        cpu: cpuValues,
    };
}


/**
 * Directory names that identify a container cgroup, across the runtimes that
 * put their containers somewhere predictable.
 */
const CONTAINER_DIRS = [
    /^docker-[0-9a-f]{12,}\.scope$/,
    /^libpod-[0-9a-f]{12,}\.scope$/,
    /^crio-[0-9a-f]{12,}\.scope$/,
    /^cri-containerd-[0-9a-f]{12,}\.scope$/,
    /^lxc\.payload\..+$/,
];

/** Where those directories live, relative to the cgroup mount root. */
const SEARCH_ROOTS = ['', '/system.slice', '/machine.slice', '/kubepods.slice', '/docker'];


function isContainerDir(name: string): boolean
{
    return CONTAINER_DIRS.some(pattern => pattern.test(name));
}


/**
 * Every container cgroup this process can actually see.
 *
 * `scope` is the important field. 'host' means the full picture; 'namespaced'
 * means we are inside a container and can only see ourselves, which is a
 * limitation of the namespace rather than an absence of containers.
 */
export function listContainers(options?: CollectorOptions): Probe<{ containers: ContainerInfo[]; scope: 'host' | 'namespaced' }>
{
    if (process.platform !== 'linux') {
        return unavailable('unsupported-platform', 'containers are a Linux concept');
    }

    const version = detectCgroupVersion(options);

    if (version === 1) {
        return unavailable('unsupported-platform', 'sibling enumeration requires cgroup v2');
    }

    const root = sysfsRoot(options);
    const inside = detectContainer(options);
    const scope = inside.available && inside.inContainer ? 'namespaced' : 'host';

    const containers: ContainerInfo[] = [];

    for (const searchRoot of SEARCH_ROOTS) {
        let entries: string[];

        try {
            entries = readdirSync(`${root}${searchRoot}`);
        }
        catch {
            // a search root that does not exist on this host is not an error,
            // it just means that runtime is not installed
            continue;
        }

        for (const name of entries) {
            if (!isContainerDir(name)) {
                continue;
            }

            const path = `${searchRoot}/${name}`;
            const dir = `${root}${path}`;

            const limits = readCgroupLimits(dir, version);
            const cpu = readCgroupCpu(dir, version);

            if (!limits.available || !cpu.available) {
                continue;
            }

            const { available: _l, ...limitValues } = limits;
            const { available: _c, ...cpuValues } = cpu;

            containers.push({
                id: name,
                path,
                version,
                runtime: runtimeFromPath(path) ?? 'unknown',
                limits: limitValues,
                cpu: cpuValues,
            });
        }
    }

    if (containers.length === 0 && scope === 'namespaced') {
        // we are in a container and can see nothing else, which is expected -
        // report our own cgroup rather than an empty list that reads as a bug
        const self = getContainerInfo(options);

        if (self.available) {
            const { available: _s, ...info } = self;
            containers.push(info);
        }
    }

    return { available: true, containers, scope };
}


/**
 * Convert two cpu.stat readings into a percentage, on the same scale as the
 * process view: 100 means one fully-occupied core.
 */
export function diffContainerCpu(prev: CgroupCpuStat, next: CgroupCpuStat, elapsedMs: number)
{
    const deltaUsec = Math.max(0, next.usageUsec - prev.usageUsec);
    const windowUsec = elapsedMs * 1000;

    const cpuRatio = windowUsec > 0 ? deltaUsec / windowUsec : 0;

    return { cpuRatio, cpuPercentage: cpuRatio * 100 };
}
