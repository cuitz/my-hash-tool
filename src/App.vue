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
const completionToast = ref('')
const completionToastTone = ref<'neutral' | 'error'>('neutral')
let completionToastTimer = 0

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

  return {
    count: warningFiles.value.length,
    totalSize
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

function handleDragEnter(event: DragEvent) {
  if (route.value !== 'main' || isHashing.value) return
  event.preventDefault()
  isDragging.value = true
}

function handleDragOver(event: DragEvent) {
  if (route.value !== 'main' || isHashing.value) return
  event.preventDefault()
  if (!isDragging.value) isDragging.value = true
}

function handleDragLeave(event: DragEvent) {
  const related = event.relatedTarget as Node | null
  const current = event.currentTarget as HTMLElement
  if (!related || !current.contains(related)) {
    isDragging.value = false
  }
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  isDragging.value = false

  if (route.value !== 'main' || isHashing.value) return

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

function clearTasks() {
  if (isHashing.value) return
  tasks.value = []
  textInput.value = ''
  inputRepresentsFiles.value = false
  copiedKey.value = ''
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
  notifyBatchFinished(tasks.value)
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

  if (!(await copyText(value))) return

  copiedKey.value = `${task.id}-${algorithm}`
  window.setTimeout(() => {
    if (copiedKey.value === `${task.id}-${algorithm}`) {
      copiedKey.value = ''
    }
  }, 1500)
}

async function copyTaskHashes(task: HashTask) {
  if (!task.hashes) return

  if (!(await copyText(formatTaskHashes(task)))) return

  copiedKey.value = `${task.id}-all`
  window.setTimeout(() => {
    if (copiedKey.value === `${task.id}-all`) {
      copiedKey.value = ''
    }
  }, 1500)
}

async function copyAllHashes() {
  const doneTasks = tasks.value.filter((task) => task.status === 'done' && task.hashes)
  if (!doneTasks.length) return

  if (!(await copyText(doneTasks.map((task) => formatTaskHashes(task)).join('\n\n')))) return

  copiedKey.value = 'all-results'
  window.setTimeout(() => {
    if (copiedKey.value === 'all-results') {
      copiedKey.value = ''
    }
  }, 1500)
}

async function copyText(value: string) {
  try {
    if (!window.ztools?.copyText?.(value)) {
      await navigator.clipboard.writeText(value)
    }
  } catch (error) {
    notifyError(error, '复制失败')
    return false
  }

  return true
}

function formatTaskHashes(task: HashTask) {
  if (!task.hashes) return ''

  const title = task.kind === 'file' ? task.path : '字符串输入'

  return [
    title,
    `MD5: ${task.hashes.md5}`,
    `SHA1: ${task.hashes.sha1}`,
    `SHA256: ${task.hashes.sha256}`
  ].join('\n')
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
  showCompletionToast(message, 'error')
}

function notifyBatchFinished(finishedTasks: HashTask[]) {
  if (finishedTasks.length <= 1) return

  const failedCount = finishedTasks.filter((task) => task.status === 'error').length
  const doneCount = finishedTasks.length - failedCount
  const message = failedCount
    ? `Hash 计算完成：${doneCount} 个成功，${failedCount} 个失败`
    : `Hash 计算完成：${doneCount} 个文件已处理`

  showCompletionToast(message, 'neutral')
}

function showCompletionToast(message: string, tone: 'neutral' | 'error' = 'neutral') {
  completionToast.value = message
  completionToastTone.value = tone

  if (completionToastTimer) {
    window.clearTimeout(completionToastTimer)
  }

  completionToastTimer = window.setTimeout(() => {
    completionToast.value = ''
    completionToastTimer = 0
  }, 2600)
}

function handlePluginEnter(action: PluginFileEnterAction) {
  route.value = 'main'

  if (action.type !== 'files' || !Array.isArray(action.payload)) return
  if (isHashing.value) {
    showCompletionToast('正在计算中，请稍后再添加文件', 'error')
    return
  }

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
  <main
    class="app-shell"
    :class="{ 'is-drop-target': isDragging && route === 'main' }"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <template v-if="route === 'main'">
      <header class="main-actions">
        <span class="algorithm-note">MD5 / SHA1 / SHA256</span>
        <div class="main-action-buttons">
          <button
            v-if="tasks.length && !isHashing"
            class="text-button"
            type="button"
            title="清空当前任务"
            @click="clearTasks"
          >
            清空
          </button>
          <button
            v-if="!isHashing && tasks.some((task) => task.status === 'done')"
            class="secondary-button"
            type="button"
            title="复制全部已完成结果"
            @click="copyAllHashes"
          >
            {{ copiedKey === 'all-results' ? '已复制全部' : '复制全部结果' }}
          </button>
          <button class="icon-button" type="button" title="设置" @click="openSettings">设置</button>
        </div>
      </header>

      <section
        class="input-zone"
        :class="{ 'is-dragging': isDragging, 'is-busy': isHashing, 'is-file-mode': inputRepresentsFiles }"
      >
        <label class="input-label" for="hash-input">
          {{ isDragging ? '松开开始计算文件 Hash' : inputRepresentsFiles ? `已选择 ${tasks.length || textInput.split('\n').filter(Boolean).length} 个文件` : '输入字符串或拖入文件' }}
        </label>
        <textarea
          id="hash-input"
          v-model="textInput"
          :disabled="isHashing"
          :readonly="inputRepresentsFiles"
          spellcheck="false"
          placeholder="在这里输入或粘贴字符串；也可以把文件拖到这个输入框区域。"
          @input="handleTextInput"
          @keydown.meta.enter.prevent="hashTextInput"
          @keydown.ctrl.enter.prevent="hashTextInput"
        ></textarea>
        <div class="input-actions">
          <span class="shortcut-hint">⌘/Ctrl + Enter 开始计算</span>
          <button
            class="secondary-button"
            type="button"
            :disabled="isHashing || inputRepresentsFiles"
            @click="hashTextInput"
          >
            计算字符串
          </button>
          <button class="primary-button" type="button" :disabled="isHashing" @click="selectFiles">
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
              <h2 :title="task.kind === 'file' ? task.path : task.text">
                <span class="file-title__name">{{ task.name }}</span>
              </h2>
              <p :title="task.kind === 'file' ? task.path : task.text">{{ getTaskMeta(task) }}</p>
            </div>
            <div class="task-card__tools">
              <span class="file-size">{{ getTaskSize(task) }}</span>
              <button
                v-if="task.status === 'done'"
                class="copy-button"
                type="button"
                title="复制该项全部 Hash"
                @click="copyTaskHashes(task)"
              >
                {{ copiedKey === `${task.id}-all` ? '已复制' : '复制全部' }}
              </button>
            </div>
          </div>

          <div class="progress-meta">
            <span>{{ getStatusText(task) }}</span>
            <span>{{ task.progress }}%</span>
          </div>
          <div
            class="progress-track"
            role="progressbar"
            :aria-valuenow="task.progress"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`${task.name} 计算进度`"
          >
            <div class="progress-fill" :style="{ width: `${task.progress}%` }"></div>
          </div>

          <dl class="hash-list">
            <div v-for="algorithm in HASH_ALGORITHMS" :key="algorithm" class="hash-row">
              <dt>{{ algorithm.toUpperCase() }}</dt>
              <dd>
                <button
                  type="button"
                  class="hash-value"
                  :class="{ 'is-interactive': task.status === 'done' }"
                  :disabled="task.status !== 'done'"
                  :title="task.status === 'done' ? '点击复制' : getHashValue(task, algorithm)"
                  @click="task.status === 'done' && copyHash(task, algorithm)"
                >
                  {{ getHashValue(task, algorithm) }}
                </button>
                <span
                  v-if="task.status === 'done' && copiedKey === `${task.id}-${algorithm}`"
                  class="copied-flag"
                  role="status"
                  aria-live="polite"
                >已复制</span>
              </dd>
            </div>
          </dl>
        </article>
      </section>

      <div v-if="isDragging && route === 'main'" class="drop-overlay" aria-hidden="true">
        <div class="drop-overlay__panel">松开以开始计算文件 Hash</div>
      </div>

      <div v-if="warningVisible" class="modal-layer" role="presentation">
        <section class="warning-dialog" role="dialog" aria-modal="true" aria-labelledby="large-file-title">
          <p class="eyebrow">大文件提醒</p>
          <h2 id="large-file-title">计算可能需要较长时间</h2>
          <p>
            本次选择 {{ warningSummary.count }} 个文件，共
            {{ formatBytes(warningSummary.totalSize) }}。插件会使用流式读取，不会一次性加载整个文件。
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

      <Transition name="completion-toast">
        <p
          v-if="completionToast"
          class="completion-toast"
          :class="`is-${completionToastTone}`"
          role="status"
          aria-live="polite"
        >
          {{ completionToast }}
        </p>
      </Transition>
    </template>

    <template v-else>
      <header class="settings-header">
        <button class="icon-button" type="button" @click="closeSettings">← 返回</button>
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
