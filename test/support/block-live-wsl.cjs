/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, process */
// Preloaded only by live-opt-in.test.ts. Record attempted WSL launches and
// reject them before the user's host can start a distribution.
const childProcess = require('node:child_process')
const { appendFileSync } = require('node:fs')
const { syncBuiltinESMExports } = require('node:module')

for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync']) {
  const original = childProcess[method]
  childProcess[method] = function (file, ...args) {
    if (typeof file === 'string' && /(?:^|[\\/\s"'])wsl(?:\.exe)?(?:$|[\s"'])/i.test(file)) {
      appendFileSync(process.env.WSLPAD_SPAWN_ATTEMPT_LOG, `${method}: ${file}\n`)
      throw new Error('Live WSL launch blocked by regression test')
    }
    return original.call(this, file, ...args)
  }
}
syncBuiltinESMExports()
