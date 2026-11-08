// Compatibility route for branches whose router still treats argv[1] as the subcommand when it is
// actually an option. See lib/commands/discover/full.mjs for why this exists.
import { run } from '../discover.mjs'

export const route = { cmd: 'discover', sub: '--probe-unknown' }

export { run }
