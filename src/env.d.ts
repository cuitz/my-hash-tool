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

  type CoreHashAlgorithm = 'md5' | 'sha1' | 'sha256'
  type ExtraHashAlgorithm = 'crc32' | 'sha384' | 'sha512'
  type HashAlgorithm = CoreHashAlgorithm | ExtraHashAlgorithm
  type HashResult = Partial<Record<HashAlgorithm, string>> & Record<CoreHashAlgorithm, string>

  interface Services {
    selectFiles: () => FileInfo[]
    getFileInfos: (filePaths: string[]) => FileInfo[]
    getDroppedFileInfos: (files: FileList | File[]) => FileInfo[]
    hashFile: (
      filePath: string,
      algorithms: HashAlgorithm[],
      onProgress?: (progress: HashProgress) => void
    ) => Promise<HashResult>
    hashText: (text: string, algorithms: HashAlgorithm[]) => HashResult
  }

  interface Window {
    services: Services
    ztools?: ZToolsApi
  }
}

export {}
