/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

declare global {
  type FileInfo = {
    path: string
    name: string
    size: number
  }

  type HashProgress = {
    path: string
    bytesRead: number
    totalBytes: number
    progress: number
  }

  type HashResult = {
    md5: string
    sha1: string
    sha256: string
  }

  interface Services {
    selectFiles: () => FileInfo[]
    getFileInfos: (filePaths: string[]) => FileInfo[]
    getDroppedFileInfos: (files: FileList | File[]) => FileInfo[]
    hashFile: (
      filePath: string,
      onProgress?: (progress: HashProgress) => void
    ) => Promise<HashResult>
    hashText: (text: string) => HashResult
  }

  interface Window {
    services: Services
    ztools?: ZToolsApi
  }
}

export {}
