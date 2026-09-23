import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const result = spawnSync(process.execPath, [join(root, 'node_modules/electron-builder/cli.js'), '--win', '--publish', 'never'], {
  cwd: root,
  env: { ...process.env, ELECTRON_BUILDER_CACHE: join(root, '.builder-cache') },
  stdio: 'inherit'
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
