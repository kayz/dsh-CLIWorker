// Compatibility route for branches whose router still treats argv[1] as the subcommand when it is
// actually an option. A router that collapses leading-dash options to `sub: null` ignores this
// entry and dispatches to lib/commands/discover.mjs instead. Keeping it here avoids editing the
// shared router while still making `cliworker discover --full` reachable.
import { run } from '../discover.mjs'

export const route = { cmd: 'discover', sub: '--full' }

export { run }
