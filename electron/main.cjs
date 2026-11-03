const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const MAX_PROGRESS_BYTES = 20 * 1024 * 1024

if (process.env.HSK_SMOKE === '1') {
  app.setPath('userData', path.join(os.tmpdir(), `hsk-slova-smoke-${process.pid}`))
}

const ALLOWED_HOSTS = new Set([
  'gushichinese.com',
  'creativecommons.org',
  'www.mdbg.net',
  'mdbg.net',
  'tatoeba.org',
  'github.com',
])

let datasetCache = null

function datasetPath() {
  return path.join(__dirname, '..', 'data', 'hsk30.json')
}

function progressPath() {
  return path.join(app.getPath('userData'), 'progress.json')
}

function readDataset() {
  if (!datasetCache) datasetCache = JSON.parse(fs.readFileSync(datasetPath(), 'utf8'))
  return datasetCache
}

function readProgress() {
  try {
    return JSON.parse(fs.readFileSync(progressPath(), 'utf8'))
  } catch {
    return null
  }
}

function writeProgress(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Плохой файл прогресса')
  }
  const text = JSON.stringify(data)
  if (Buffer.byteLength(text) > MAX_PROGRESS_BYTES) throw new Error('Файл прогресса слишком большой')
  fs.mkdirSync(path.dirname(progressPath()), { recursive: true })
  const tmp = `${progressPath()}.tmp`
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, progressPath())
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 880,
    minHeight: 640,
    title: 'HSK Слова',
    backgroundColor: '#f3efe6',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  if (process.env.HSK_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
  if (process.env.HSK_SMOKE === '1') attachSmoke(win)

  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'))
  return win
}

function attachSmoke(win) {
  const script = `(() => new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      const app = document.querySelector('#app')
      if (app && app.dataset.ready === 'error') return reject(new Error(app.innerText))
      if (app && app.dataset.ready === '1' && document.querySelector('.hanzi')) {
        const first = document.querySelector('.hanzi').textContent
        document.querySelector('[data-action="reveal"]').click()
        const revealed = document.querySelector('[data-revealed="1"]')
        const meaning = document.querySelector('.meaning')?.textContent || ''
        document.querySelector('[data-grade="1"]').click()
        const select = document.querySelector('#difficulty-select')
        select.value = 'hard'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        const hardHanzi = document.querySelector('.hanzi')?.textContent || ''
        document.querySelector('[data-nav="quiz"]').click()
        document.querySelector('[data-action="start-quiz"]').click()
        const choice = document.querySelector('[data-action="choose"]')
        if (choice) choice.click()
        return resolve({
          first,
          revealed: Boolean(revealed),
          meaning,
          hardHanzi,
          feedback: document.querySelector('.feedback')?.textContent || '',
          total: document.querySelector('#stat-total')?.textContent || '',
        })
      }
      if (Date.now() - start > 8000) return reject(new Error('timeout waiting for app'))
      setTimeout(tick, 40)
    }
    tick()
  }))()`

  win.webContents.on('did-finish-load', async () => {
    try {
      const result = await win.webContents.executeJavaScript(script, true)
      console.log(`HSK_SMOKE_RESULT ${JSON.stringify(result)}`)
      app.exit(result.revealed && result.meaning && result.hardHanzi ? 0 : 1)
    } catch (error) {
      console.error(`HSK_SMOKE_FAIL ${error && error.stack ? error.stack : error}`)
      app.exit(1)
    }
  })
}

function buildMenu() {
  const template = [
    {
      label: 'HSK Слова',
      submenu: [
        { role: 'about', label: 'О программе' },
        { type: 'separator' },
        { role: 'quit', label: 'Выйти' },
      ],
    },
    {
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' },
        { role: 'redo', label: 'Повторить' },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Копировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выделить всё' },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { role: 'reload', label: 'Обновить' },
        { role: 'resetZoom', label: 'Обычный размер' },
        { role: 'zoomIn', label: 'Крупнее' },
        { role: 'zoomOut', label: 'Мельче' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'На весь экран' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.setName('HSK Слова')
app.setAboutPanelOptions({
  applicationName: 'HSK Слова',
  applicationVersion: app.getVersion(),
  copyright: 'Список слов: Gushi, CC BY-SA 4.0. Код программы: MIT.',
})

ipcMain.handle('dataset:load', () => readDataset())
ipcMain.handle('progress:load', () => readProgress())
ipcMain.handle('progress:save', (_event, data) => {
  writeProgress(data)
  return true
})
ipcMain.handle('progress:export', async (_event, data) => {
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Сохранить прогресс',
    defaultPath: 'hsk-progress.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (canceled || !filePath) return false
  const pretty = JSON.stringify(data, null, 2)
  if (Buffer.byteLength(pretty) > MAX_PROGRESS_BYTES) throw new Error('Файл прогресса слишком большой')
  fs.writeFileSync(filePath, pretty)
  writeProgress(data)
  return true
})
ipcMain.handle('progress:import', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog({
    title: 'Загрузить прогресс',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (canceled || !filePaths[0]) return null
  const stat = fs.statSync(filePaths[0])
  if (stat.size > MAX_PROGRESS_BYTES) throw new Error('Файл слишком большой')
  return JSON.parse(fs.readFileSync(filePaths[0], 'utf8'))
})
ipcMain.handle('open:external', (_event, url) => {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) return false
    shell.openExternal(parsed.toString())
    return true
  } catch {
    return false
  }
})

app.whenReady().then(() => {
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
