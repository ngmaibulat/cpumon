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
import type { Probe } from '../types.js';
import type { CgroupCpuStat, CgroupLimits, CgroupVersion } from './cgroup.js';
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
/**
 * Whether this process is running inside a container, and under what.
 *
 * Marker files come first because they are definitive. The cgroup path is a
 * good second signal but not a first one: a systemd user session on a bare
 * host has a deeply nested cgroup path and is not a container.
 */
export declare function detectContainer(options?: CollectorOptions): Probe<ContainerRuntimeInfo>;
/** This process's own cgroup, whether or not it is a container. */
export declare function getContainerInfo(options?: CollectorOptions): Probe<ContainerInfo>;
/**
 * Every container cgroup this process can actually see.
 *
 * `scope` is the important field. 'host' means the full picture; 'namespaced'
 * means we are inside a container and can only see ourselves, which is a
 * limitation of the namespace rather than an absence of containers.
 */
export declare function listContainers(options?: CollectorOptions): Probe<{
    containers: ContainerInfo[];
    scope: 'host' | 'namespaced';
}>;
/**
 * Convert two cpu.stat readings into a percentage, on the same scale as the
 * process view: 100 means one fully-occupied core.
 */
export declare function diffContainerCpu(prev: CgroupCpuStat, next: CgroupCpuStat, elapsedMs: number): {
    cpuRatio: number;
    cpuPercentage: number;
};
