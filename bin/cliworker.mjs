#!/usr/bin/env node
import { main } from '../lib/cli.mjs'
import { createContext } from '../lib/context.mjs'

const { exitCode } = await main(process.argv.slice(2), createContext())
process.exitCode = exitCode
