/**
 * Colour, for a suite that runs without a terminal.
 *
 * A handful of assertions are about the escape sequences themselves - that the
 * selected table row inverts on a theme with no selection colour, say - and
 * chalk emits none of them when stdout is not a TTY. The package scripts set
 * FORCE_COLOR for that reason, which leaves those tests passing only when the
 * suite is entered through `bun run test`.
 *
 * Setting the level rather than only the environment variable is deliberate.
 * chalk reads FORCE_COLOR once, when it is first imported, so under a single
 * `bun test` across the workspace the variable arrives too late - libsysmon's
 * collectors pull chalk in first and it has already settled on 0. The level is
 * writable at any point, and there is one hoisted copy of chalk that ink
 * renders through, so this reaches the components either way.
 *
 * The environment variable stays for the child processes the suite spawns,
 * which get their own chalk.
 */

import chalk from 'chalk';


process.env.FORCE_COLOR ??= '3';

chalk.level = 3;
