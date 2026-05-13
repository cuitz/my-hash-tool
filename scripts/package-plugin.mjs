import { existsSync, rmSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs'
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

// 使用跨平台的 JSZip 库代替系统 zip 命令
const JSZip = (await import('jszip')).default
const zip = new JSZip()

// 递归添加文件到 zip
function addFilesToZip(dirPath, zipFolder) {
  const files = readdirSync(dirPath)
  for (const file of files) {
    const filePath = join(dirPath, file)
    const stat = statSync(filePath)

    if (stat.isDirectory()) {
      addFilesToZip(filePath, zipFolder.folder(file))
    } else {
      const content = readFileSync(filePath)
      zipFolder.file(file, content)
    }
  }
}

addFilesToZip(distDir, zip.folder())

const content = await zip.generateAsync({ type: 'nodebuffer' })
writeFileSync(packagePath, content)

console.log(`\nCreated ${basename(packagePath)}`)
