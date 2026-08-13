/**
 * Sending a signal to a process.
 *
 * The only destructive thing this dashboard can do, and the only place it
 * touches the machine rather than reading it. Everything here is built so that
 * the dangerous part is a single call at the bottom of a function whose inputs
 * were all decided somewhere testable.
 *
 * The ordering of the signal list is deliberate. TERM first because it is what
 * you almost always want and what the default should be; KILL is present
 * because sometimes it is genuinely needed, but it sits below STOP and CONT so
 * that a mis-aimed keypress in a list lands on something recoverable.
 */

export type SignalName = 'SIGTERM' | 'SIGHUP' | 'SIGINT' | 'SIGSTOP' | 'SIGCONT' | 'SIGKILL';


export type SignalChoice = {
    name: SignalName;
    /** what it does, in the terms someone deciding would want */
    description: string;
    /** cannot be caught, ignored, or undone by the process */
    forceful: boolean;
};


export const SIGNALS: SignalChoice[] = [
    { name: 'SIGTERM', description: 'ask it to exit', forceful: false },
    { name: 'SIGHUP', description: 'hang up; many daemons reload their config', forceful: false },
    { name: 'SIGINT', description: 'interrupt, as Ctrl-C would', forceful: false },
    { name: 'SIGSTOP', description: 'suspend it; SIGCONT resumes', forceful: true },
    { name: 'SIGCONT', description: 'resume a suspended process', forceful: false },
    { name: 'SIGKILL', description: 'cannot be caught; no chance to clean up', forceful: true },
];


export const DEFAULT_SIGNAL: SignalName = 'SIGTERM';


export type KillResult = {
    ok: boolean;
    /** one line, for the footer */
    message: string;
};


export type Killer = (pid: number, signal: SignalName) => void;


/**
 * Send a signal and turn the outcome into something to show.
 *
 * Never throws. A failure here is ordinary - the process exited a moment ago,
 * or it belongs to another user - and an exception would tear down the render
 * tree over something that deserves one line in the footer.
 *
 * `kill` is injected so the tests can prove which signal reaches which pid
 * without any test run ever signalling a real process.
 */
export function sendSignal(
    pid: number,
    signal: SignalName,
    kill: Killer = (target, name) => { process.kill(target, name); },
): KillResult
{
    if (!Number.isInteger(pid) || pid <= 0) {
        // a negative pid is a process *group* to the kill syscall, so a bad
        // value here would not fail, it would signal something much larger
        return { ok: false, message: `refusing to signal pid ${pid}` };
    }

    try {
        kill(pid, signal);

        return { ok: true, message: `sent ${signal} to ${pid}` };
    }
    catch (err) {
        return { ok: false, message: explain(err, pid, signal) };
    }
}


function explain(err: unknown, pid: number, signal: SignalName): string
{
    const code = (err as NodeJS.ErrnoException).code;

    if (code === 'EPERM') {
        return `not permitted to signal ${pid}; it belongs to another user`;
    }

    if (code === 'ESRCH') {
        // between the frame being drawn and the key being pressed - which is
        // exactly the race the frozen list is meant to make rare, not impossible
        return `process ${pid} is already gone`;
    }

    if (code === 'EINVAL') {
        return `${signal} is not a signal this platform knows`;
    }

    return `could not signal ${pid}: ${(err as Error).message}`;
}
