import { addModel, parseModelOptions } from '../../models/directory.mjs'

export const route = { cmd: 'models', sub: 'add' }

const FLAGS = ['--readonly', '--stdin']
const VALUED = ['--provider', '--id', '--level', '--vendor', '--context-tokens', '--input-price', '--output-price']

// Adds one explicit model/v1 record. Invalid levels and unknown providers are rejected by
// lib/models/directory.mjs with E_BAD_LEVEL and E_UNKNOWN_MODEL respectively; the record is
// written atomically under the configuration lock and a duplicate key is an explicit error.
export async function run({ argv, ctx, config }) {
  return addModel(parseModelOptions(argv, { flags: FLAGS, valued: VALUED }), { ctx, config })
}
