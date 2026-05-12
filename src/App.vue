<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

type TaskStatus = 'waiting' | 'hashing' | 'done' | 'error'

type BaseHashTask = {
  id: string
  kind: 'file' | 'text'
  name: string
  size: number
  status: TaskStatus
  progress: number
  error: string
  hashes: HashResult | null
}

type FileHashTask = BaseHashTask &
  FileInfo & {
    kind: 'file'
  }

type TextHashTask = BaseHashTask & {
  kind: 'text'
  path: ''
  text: string
}

type HashTask = FileHashTask | TextHashTask

type PluginFileEnterAction = {
  type: string
  payload?: Array<{ path?: string }>
}

type Settings = {
  largeFileWarningEnabled: boolean
  largeFileWarningThresholdGB: number
}

const SETTINGS_KEY = 'my-hash-tool.settings'
const DEFAULT_SETTINGS: Settings = {
  largeFileWarningEnabled: true,
  largeFileWarningThresholdGB: 2
}
const BYTES_PER_GB = 1024 * 1024 * 1024
const HASH_ALGORITHMS: Array<keyof HashResult> = ['md5', 'sha1', 'sha256']

const route = ref<'main' | 'settings'>('main')
const tasks = ref<HashTask[]>([])
const textInput = ref('')
const inputRepresentsFiles = ref(false)
const isDragging = ref(false)
const isHashing = ref(false)
const copiedKey = ref('')
const warningFiles = ref<FileInfo[]>([])
const warningVisible = ref(false)
const disableFutureWarnings = ref(false)
const settings = reactive<Settings>({ ...DEFAULT_SETTINGS })

const thresholdInput = computed({
  get: () => String(settings.largeFileWarningThresholdGB),
  set: (value: string) => {
    const nextValue = Number(value)
    if (Number.isFinite(nextValue)) {
      settings.largeFileWarningThresholdGB = nextValue
    }
  }
})

const taskSummary = computed(() => {
  const summary = {
    total: tasks.value.length,
    done: 0,
    hashing: 0,
    waiting: 0,
    error: 0
  }

  for (const task of tasks.value) {
    summary[task.status] += 1
  }

  return summary
})

const warningSummary = computed(() => {
  const totalSize = warningFiles.value.reduce((sum, file) => sum + file.size, 0)
  const largestFile = warningFiles.value.reduce<FileInfo | null>((largest, file) => {
    if (!largest || file.size > largest.size) return file
    return largest
  }, null)

  return {
    count: warningFiles.value.length,
    totalSize,
    largestFile
  }
})

function loadSettings() {
  try {
    const saved = window.ztools?.dbStorage?.getItem<Partial<Settings>>(SETTINGS_KEY)
    Object.assign(settings, normalizeSettings(saved))
  } catch {
    const saved = window.localStorage.getItem(SETTINGS_KEY)
    if (saved) {
      Object.assign(settings, normalizeSettings(JSON.parse(saved)))
    }
  }
}

function saveSettings() {
  const nextSettings = normalizeSettings(settings)
  Object.assign(settings, nextSettings)

  try {
    window.ztools?.dbStorage?.setItem(SETTINGS_KEY, nextSettings)
  } catch {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(nextSettings))
  }
}

function normalizeSettings(value?: Partial<Settings> | null): Settings {
  const threshold = Number(value?.largeFileWarningThresholdGB)

  return {
    largeFileWarningEnabled:
      typeof value?.largeFileWarningEnabled === 'boolean'
        ? value.largeFileWarningEnabled
        : DEFAULT_SETTINGS.largeFileWarningEnabled,
    largeFileWarningThresholdGB:
      Number.isFinite(threshold) && threshold >= 1 && threshold <= 1024
        ? Number(threshold.toFixed(2))
        : DEFAULT_SETTINGS.largeFileWarningThresholdGB
  }
}

function updateThreshold() {
  saveSettings()
}

function openSettings() {
  route.value = 'settings'
}

function closeSettings() {
  saveSettings()
  route.value = 'main'
}

function selectFiles() {
  if (isHashing.value) return
  if (!window.services) {
    notifyError('请在 ZTools 中选择文件，浏览器预览仅用于查看界面', '当前环境不可用')
    return
  }

  try {
    const files = window.services.selectFiles()
    handleFiles(files)
  } catch (error) {
    notifyError(error, '选择文件失败')
  }
}

function hashTextInput() {
  if (isHashing.value) return
  if (inputRepresentsFiles.value) return

  const text = textInput.value
  if (!text.length) {
    notifyError('请输入需要计算 Hash 的字符串，或拖入文件', '输入为空')
    return
  }

  startTextHashing(text)
}

function handleDragOver(event: DragEvent) {
  event.preventDefault()
  if (!isHashing.value) {
    isDragging.value = true
  }
}

function handleDragLeave(event: DragEvent) {
  if (event.currentTarget === event.target) {
    isDragging.value = false
  }
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  isDragging.value = false

  if (isHashing.value) return

  const files = event.dataTransfer?.files
  if (!files?.length) return

  try {
    if (!window.services) {
      notifyError('请在 ZTools 中拖入文件，浏览器预览仅用于查看界面', '当前环境不可用')
      return
    }

    handleFiles(window.services.getDroppedFileInfos(files))
  } catch (error) {
    notifyError(error, '读取文件信息失败')
  }
}

function handleFiles(files: FileInfo[]) {
  if (!files.length) return

  const normalizedFiles = dedupeFiles(files)
  textInput.value = normalizedFiles.map((file) => file.path).join('\n')
  inputRepresentsFiles.value = true

  if (shouldWarnLargeFiles(normalizedFiles)) {
    warningFiles.value = normalizedFiles
    warningVisible.value = true
    disableFutureWarnings.value = false
    return
  }

  void startHashing(normalizedFiles)
}

function dedupeFiles(files: FileInfo[]) {
  const seen = new Set<string>()
  return files.filter((file) => {
    if (seen.has(file.path)) return false
    seen.add(file.path)
    return true
  })
}

function shouldWarnLargeFiles(files: FileInfo[]) {
  if (!settings.largeFileWarningEnabled) return false

  const thresholdBytes = settings.largeFileWarningThresholdGB * BYTES_PER_GB
  const totalSize = files.reduce((sum, file) => sum + file.size, 0)
  return totalSize > thresholdBytes || files.some((file) => file.size > thresholdBytes)
}

function continueAfterWarning() {
  if (disableFutureWarnings.value) {
    settings.largeFileWarningEnabled = false
    saveSettings()
  }

  warningVisible.value = false
  void startHashing(warningFiles.value)
}

function cancelWarning() {
  warningVisible.value = false
  warningFiles.value = []
  disableFutureWarnings.value = false
}

async function startHashing(files: FileInfo[]) {
  tasks.value = files.map(createTask)
  isHashing.value = true

  for (const task of tasks.value) {
    task.status = 'hashing'
    task.error = ''
    task.progress = 0

    try {
      task.hashes = await window.services.hashFile(task.path, (progress) => {
        task.progress = Math.round(progress.progress)
      })
      task.progress = 100
      task.status = 'done'
    } catch (error) {
      task.status = 'error'
      task.error = getErrorMessage(error)
      task.progress = 0
    }
  }

  isHashing.value = false
}

function startTextHashing(text: string) {
  const task = createTextTask(text)
  tasks.value = [task]
  isHashing.value = true
  task.status = 'hashing'
  task.progress = 35

  window.setTimeout(() => {
    try {
      task.hashes = window.services.hashText(text)
      task.progress = 100
      task.status = 'done'
    } catch (error) {
      task.status = 'error'
      task.error = getErrorMessage(error)
      task.progress = 0
    } finally {
      isHashing.value = false
    }
  }, 80)
}

function createTask(file: FileInfo): FileHashTask {
  return {
    ...file,
    id: `${file.path}-${file.size}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind: 'file',
    status: 'waiting',
    progress: 0,
    error: '',
    hashes: null
  }
}

function createTextTask(text: string): TextHashTask {
  return {
    id: `text-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind: 'text',
    path: '',
    text,
    name: '字符串输入',
    size: new TextEncoder().encode(text).length,
    status: 'waiting',
    progress: 0,
    error: '',
    hashes: null
  }
}

function getStatusText(task: HashTask) {
  if (task.status === 'waiting') return '等待计算'
  if (task.status === 'hashing') return '正在计算'
  if (task.status === 'done') return '计算完成'
  return task.kind === 'file' ? `读取失败：${task.error}` : `计算失败：${task.error}`
}

function getHashValue(task: HashTask, algorithm: keyof HashResult) {
  if (task.status === 'done' && task.hashes) return task.hashes[algorithm]
  if (task.status === 'error') return '未计算'
  if (task.status === 'waiting') return '等待计算'
  return '正在计算...'
}

async function copyHash(task: HashTask, algorithm: keyof HashResult) {
  if (!task.hashes) return

  const value = task.hashes[algorithm]

  try {
    if (!window.ztools?.copyText?.(value)) {
      await navigator.clipboard.writeText(value)
    }
  } catch (error) {
    notifyError(error, '复制失败')
    return
  }

  copiedKey.value = `${task.id}-${algorithm}`
  window.setTimeout(() => {
    if (copiedKey.value === `${task.id}-${algorithm}`) {
      copiedKey.value = ''
    }
  }, 1500)
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** unitIndex

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

function getTaskMeta(task: HashTask) {
  if (task.kind === 'text') {
    return `${task.text.length} 个字符 / ${formatBytes(task.size)}`
  }

  return task.path
}

function getTaskSize(task: HashTask) {
  if (task.kind === 'text') return 'UTF-8'
  return formatBytes(task.size)
}

function handleTextInput() {
  inputRepresentsFiles.value = false
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return '未知错误'
}

function notifyError(error: unknown, title: string) {
  const message = `${title}：${getErrorMessage(error)}`
  try {
    window.ztools?.showNotification?.(message)
  } catch {
    // Notification is best-effort in browser preview and non-ZTools environments.
  }
}

function handlePluginEnter(action: PluginFileEnterAction) {
  route.value = 'main'

  if (action.type !== 'files' || !Array.isArray(action.payload)) return

  const paths = action.payload.map((item: { path?: string }) => item.path).filter(Boolean)
  if (!paths.length) return

  try {
    if (!window.services) return
    handleFiles(window.services.getFileInfos(paths))
  } catch (error) {
    notifyError(error, '读取文件信息失败')
  }
}

onMounted(() => {
  loadSettings()

  window.ztools?.onPluginEnter?.(handlePluginEnter)
  window.ztools?.onPluginOut?.(() => {
    isDragging.value = false
  })
})
</script>

<template>
  <main class="app-shell">
    <template v-if="route === 'main'">
      <header class="topbar">
        <div>
          <p class="eyebrow">MD5 / SHA1 / SHA256</p>
          <h1>哈希计算器</h1>
        </div>
        <button class="icon-button" type="button" title="设置" @click="openSettings">设置</button>
      </header>

      <section
        class="input-zone"
        :class="{ 'is-dragging': isDragging, 'is-busy': isHashing }"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
        @drop="handleDrop"
      >
        <label class="input-label" for="hash-input">
          {{ isDragging ? '松开开始计算文件 Hash' : '输入字符串或拖入文件' }}
        </label>
        <textarea
          id="hash-input"
          v-model="textInput"
          :disabled="isHashing"
          spellcheck="false"
          placeholder="在这里输入或粘贴字符串；也可以把文件拖到这个输入框区域。"
          @input="handleTextInput"
          @keydown.meta.enter.prevent="hashTextInput"
          @keydown.ctrl.enter.prevent="hashTextInput"
        ></textarea>
        <div class="input-actions">
          <button
            class="primary-button"
            type="button"
            :disabled="isHashing || inputRepresentsFiles"
            @click="hashTextInput"
          >
            计算字符串
          </button>
          <button class="secondary-button" type="button" :disabled="isHashing" @click="selectFiles">
            选择文件
          </button>
        </div>
      </section>

      <section v-if="tasks.length > 1" class="summary-strip" aria-label="任务汇总">
        <span>本次任务：{{ taskSummary.total }} 项</span>
        <span>已完成 {{ taskSummary.done }}</span>
        <span>正在计算 {{ taskSummary.hashing }}</span>
        <span>等待 {{ taskSummary.waiting }}</span>
        <span v-if="taskSummary.error">失败 {{ taskSummary.error }}</span>
      </section>

      <section v-if="!tasks.length" class="empty-state">
        <h2>计算结果会显示在这里</h2>
        <p>字符串会直接计算；文件会分块读取，MD5、SHA1、SHA256 会在同一遍文件流中完成。</p>
      </section>

      <section v-else class="task-list" aria-label="Hash 计算结果">
        <article
          v-for="task in tasks"
          :key="task.id"
          class="task-card"
          :class="`is-${task.status}`"
        >
          <div class="task-card__header">
            <div class="file-title">
              <h2 :title="task.kind === 'file' ? task.path : task.text">{{ task.name }}</h2>
              <p>{{ getTaskMeta(task) }}</p>
            </div>
            <span class="file-size">{{ getTaskSize(task) }}</span>
          </div>

          <div class="progress-meta">
            <span>{{ getStatusText(task) }}</span>
            <span>{{ task.progress }}%</span>
          </div>
          <div class="progress-track" aria-hidden="true">
            <div class="progress-fill" :style="{ width: `${task.progress}%` }"></div>
          </div>

          <dl class="hash-list">
            <div v-for="algorithm in HASH_ALGORITHMS" :key="algorithm" class="hash-row">
              <dt>{{ algorithm.toUpperCase() }}</dt>
              <dd>
                <span class="hash-value" :title="getHashValue(task, algorithm)">
                  {{ getHashValue(task, algorithm) }}
                </span>
                <button
                  v-if="task.status === 'done'"
                  class="copy-button"
                  type="button"
                  :title="`复制 ${algorithm.toUpperCase()}`"
                  @click="copyHash(task, algorithm)"
                >
                  {{ copiedKey === `${task.id}-${algorithm}` ? '已复制' : '复制' }}
                </button>
              </dd>
            </div>
          </dl>
        </article>
      </section>

      <div v-if="warningVisible" class="modal-layer" role="presentation">
        <section class="warning-dialog" role="dialog" aria-modal="true" aria-labelledby="large-file-title">
          <p class="eyebrow">大文件提醒</p>
          <h2 id="large-file-title">计算可能需要较长时间</h2>
          <p>
            本次选择 {{ warningSummary.count }} 个文件，共
            {{ formatBytes(warningSummary.totalSize) }}。插件会使用流式读取，不会一次性加载整个文件。
          </p>
          <p v-if="warningSummary.largestFile" class="warning-detail">
            最大文件：{{ warningSummary.largestFile.name }}，{{ formatBytes(warningSummary.largestFile.size) }}
          </p>

          <label class="checkbox-row">
            <input v-model="disableFutureWarnings" type="checkbox" />
            <span>不再提醒大文件计算</span>
          </label>

          <div class="dialog-actions">
            <button class="secondary-button" type="button" @click="cancelWarning">取消</button>
            <button class="primary-button" type="button" @click="continueAfterWarning">继续计算</button>
          </div>
        </section>
      </div>
    </template>

    <template v-else>
      <header class="topbar">
        <div>
          <p class="eyebrow">偏好设置</p>
          <h1>设置</h1>
        </div>
        <button class="icon-button" type="button" @click="closeSettings">返回</button>
      </header>

      <section class="settings-panel">
        <div class="settings-copy">
          <h2>大文件提醒</h2>
          <p>当单个文件或本次总大小超过阈值时，计算前先提醒。</p>
        </div>

        <label class="switch-row">
          <span>超过阈值时提醒我</span>
          <input
            v-model="settings.largeFileWarningEnabled"
            type="checkbox"
            role="switch"
            @change="saveSettings"
          />
        </label>

        <label class="threshold-row">
          <span>提醒阈值</span>
          <span class="number-field">
            <input
              v-model="thresholdInput"
              type="number"
              min="1"
              max="1024"
              step="1"
              @blur="updateThreshold"
              @change="updateThreshold"
            />
            <strong>GB</strong>
          </span>
        </label>
      </section>
    </template>
  </main>
</template>
