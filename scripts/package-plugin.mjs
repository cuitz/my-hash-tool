import { existsSync, rmSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import packageJson from '../package.json' with { type: 'json' }

const rootDir = resolve(new URL('..', import.meta.url).pathname)
const distDir = join(rootDir, 'dist')
const packageName = `${packageJson.name}-v${packageJson.version}.zip`
const packagePath = join(rootDir, packageName)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
    ...options
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

run('npm', ['run', 'build'])

if (!existsSync(join(distDir, 'plugin.json'))) {
  console.error('Package failed: dist/plugin.json was not found.')
  process.exit(1)
}

rmSync(packagePath, { force: true })

run('zip', ['-r', packagePath, '.'], { cwd: distDir })

console.log(`\nCreated ${basename(packagePath)}`)
