const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const CHUNK_SIZE = 4 * 1024 * 1024
let electronWebUtils = null

try {
  electronWebUtils = require('electron').webUtils
} catch {
  electronWebUtils = null
}

function getFileInfo(filePath) {
  const stat = fs.statSync(filePath)

  if (!stat.isFile()) {
    throw new Error('请选择文件，暂不支持文件夹')
  }

  return {
    path: filePath,
    name: path.basename(filePath),
    size: stat.size
  }
}

function getDroppedFilePath(file) {
  if (file && typeof file.path === 'string' && file.path) {
    return file.path
  }

  if (electronWebUtils && typeof electronWebUtils.getPathForFile === 'function') {
    const filePath = electronWebUtils.getPathForFile(file)
    if (filePath) return filePath
  }

  throw new Error('无法读取拖入文件的路径，请使用“选择文件”按钮重试')
}

function hashFile(filePath, onProgress) {
  return new Promise((resolve, reject) => {
    let fileSize = 0

    try {
      fileSize = fs.statSync(filePath).size
    } catch (error) {
      reject(error)
      return
    }

    const hashes = {
      md5: crypto.createHash('md5'),
      sha1: crypto.createHash('sha1'),
      sha256: crypto.createHash('sha256')
    }
    const stream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE })
    let bytesRead = 0

    stream.on('data', (chunk) => {
      bytesRead += chunk.length
      hashes.md5.update(chunk)
      hashes.sha1.update(chunk)
      hashes.sha256.update(chunk)

      if (typeof onProgress === 'function') {
        onProgress({
          path: filePath,
          bytesRead,
          totalBytes: fileSize,
          progress: fileSize === 0 ? 100 : Math.min(100, (bytesRead / fileSize) * 100)
        })
      }
    })

    stream.on('error', (error) => reject(error))

    stream.on('end', () => {
      if (typeof onProgress === 'function') {
        onProgress({
          path: filePath,
          bytesRead: fileSize,
          totalBytes: fileSize,
          progress: 100
        })
      }

      resolve({
        md5: hashes.md5.digest('hex'),
        sha1: hashes.sha1.digest('hex'),
        sha256: hashes.sha256.digest('hex')
      })
    })
  })
}

function hashText(text) {
  const content = String(text)

  return {
    md5: crypto.createHash('md5').update(content, 'utf8').digest('hex'),
    sha1: crypto.createHash('sha1').update(content, 'utf8').digest('hex'),
    sha256: crypto.createHash('sha256').update(content, 'utf8').digest('hex')
  }
}

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  selectFiles() {
    const files = window.ztools.showOpenDialog({
      title: '选择需要计算 Hash 的文件',
      buttonLabel: '选择文件',
      properties: ['openFile', 'multiSelections']
    })

    if (!files) return []

    return files.map((filePath) => getFileInfo(filePath))
  },

  getFileInfos(filePaths) {
    return filePaths.map((filePath) => getFileInfo(filePath))
  },

  getDroppedFileInfos(files) {
    return Array.from(files).map((file) => getFileInfo(getDroppedFilePath(file)))
  },

  hashFile(filePath, onProgress) {
    return hashFile(filePath, onProgress)
  },

  hashText(text) {
    return hashText(text)
  }
}
