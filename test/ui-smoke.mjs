/**
 * Opens the same screens in Chrome (the renderer works without Electron)
 * and checks the paths a learner actually uses.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const chrome = process.env.CHROME_PATH || '/usr/local/bin/google-chrome'
const shots = process.env.HSK_SHOTS || '/tmp/hsk-shots'
mkdirSync(shots, { recursive: true })

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.md': 'text/plain; charset=utf-8',
}

function serve() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    const path = normalize(join(root, decodeURIComponent(url.pathname)))
    if (!path.startsWith(root)) {
      response.writeHead(403)
      response.end()
      return
    }
    try {
      const body = await readFile(path)
      response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' })
      response.end(body)
    } catch {
      response.writeHead(404)
      response.end('missing')
    }
  })
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => resolvePromise(server))
  })
}

function fail(message) {
  throw new Error(message)
}

const server = await serve()
const { port } = server.address()
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--lang=ru-RU'],
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1120, height: 800, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto(`http://127.0.0.1:${port}/src/index.html`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('#app[data-ready="1"] .hanzi')
  const first = await page.$eval('.hanzi', (el) => el.textContent)
  if (first !== '爱') fail(`expected 爱, got ${first}`)
  const total = await page.$eval('#stat-total', (el) => el.textContent)
  if (!total.includes('300')) fail(`HSK 1 count: ${total}`)

  await page.click('[data-action="reveal"]')
  await page.waitForSelector('[data-revealed="1"] .meaning')
  const meaning = await page.$eval('.meaning', (el) => el.textContent)
  if (!meaning.includes('love')) fail(meaning)
  const covered = await page.evaluate(() => {
    const example = document.querySelector('.example-zh')?.getBoundingClientRect()
    const dock = document.querySelector('.dock')?.getBoundingClientRect()
    if (!example || !dock) return 'missing example or buttons'
    if (example.bottom > dock.top + 2) return `example sits under the buttons (${Math.round(example.bottom)} > ${Math.round(dock.top)})`
    return ''
  })
  if (covered) fail(covered)
  await page.screenshot({ path: join(shots, 'cards.png') })

  await page.click('[data-grade="1"]')
  await page.select('#difficulty-select', 'hard')
  await page.waitForFunction(() => document.querySelector('.hanzi')?.textContent === '爱')
  const hardChip = await page.$eval('#stat-hard', (el) => el.textContent)
  if (!hardChip.includes('1')) fail(`hard chip: ${hardChip}`)

  await page.click('[data-nav="hard"]')
  await page.waitForSelector('.word-row')
  const hardText = await page.$eval('.word-list', (el) => el.innerText)
  if (!hardText.includes('爱') || !hardText.includes('love')) fail(hardText)
  await page.screenshot({ path: join(shots, 'hard.png') })

  await page.click('[data-nav="quiz"]')
  await page.select('#quiz-count', '5')
  await page.select('#quiz-type', 'cloze')
  await page.click('[data-action="start-quiz"]')
  await page.waitForSelector('.blank')
  const choices = await page.$$('[data-action="choose"]')
  if (choices.length !== 4) fail(`cloze choices: ${choices.length}`)
  await page.screenshot({ path: join(shots, 'quiz.png') })
  await page.click('[data-action="quiz-skip"]')
  await page.waitForSelector('.feedback')
  const feedback = await page.$eval('.feedback', (el) => el.innerText)
  if (!feedback.includes('Неверно')) fail(feedback)

  for (let i = 0; i < 4; i += 1) {
    await page.click('[data-action="quiz-next"]')
    await page.waitForSelector('[data-action="quiz-skip"], [data-action="start-quiz"]')
    const done = await page.$('[data-action="start-quiz"]')
    if (done) break
    await page.click('[data-action="quiz-skip"]')
    await page.waitForSelector('.feedback')
  }
  await page.waitForSelector('[data-action="start-quiz"]')
  const before = await page.$eval('h2', (el) => el.textContent)
  if (before !== 'Результат') fail(before)
  await page.click('[data-action="start-quiz"]')
  await page.waitForSelector('.blank')

  await page.click('[data-nav="stats"]')
  await page.waitForSelector('table')
  const learnedHeader = await page.$eval('table', (el) => el.innerText)
  if (!learnedHeader.includes('Выучены') || !learnedHeader.includes('300')) fail(learnedHeader)
  await page.screenshot({ path: join(shots, 'progress.png') })

  await page.select('#level-select', '2')
  await page.waitForFunction(() => document.querySelector('#stat-total')?.textContent?.includes('200'))
  await page.select('#level-select', 'all')
  await page.waitForFunction(() => document.querySelector('#stat-total')?.textContent?.includes('11'))

  await page.setViewport({ width: 390, height: 800, deviceScaleFactor: 1 })
  await page.click('[data-nav="cards"]')
  await page.waitForSelector('.hanzi, .empty')
  await page.screenshot({ path: join(shots, 'narrow.png') })

  if (errors.length) fail(errors.join('\n'))
  console.log(`ui ok, screenshots in ${shots}`)
} finally {
  await browser.close()
  await new Promise((resolvePromise) => server.close(resolvePromise))
}

if (process.env.HSK_OPEN_SHOTS === '1') {
  spawn('xdg-open', [shots], { stdio: 'ignore', detached: true }).unref()
}
