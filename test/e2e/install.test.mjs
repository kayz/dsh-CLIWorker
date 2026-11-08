import test from 'node:test'
import { runInstall } from '../../scripts/e2e-install.mjs'
test('[AC-065] packaged installation works', { timeout: 120000 }, () => { runInstall() })
