/**
 * Rebuild data/hsk30.json from the Gushi HSK 3.0 word list.
 *
 * Default source (CC BY-SA 4.0):
 *   https://gushichinese.com/hsk-3.0/downloads/hsk-3.0-words-all.json
 *
 * Usage:
 *   node scripts/prepare-words.mjs
 *   node scripts/prepare-words.mjs --input /path/to/hsk-3.0-words-all.json
 *
 * The script does not translate, rewrite, or invent entries. It keeps every
 * row and renames fields for the app. Stable ids are a hash of
 * level + hanzi + pinyin + meaning so progress survives reordering.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_URL = 'https://gushichinese.com/hsk-3.0/downloads/hsk-3.0-words-all.json'
const EXPECTED_COUNT = 11000
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outPath = resolve(root, 'data/hsk30.json')

function argInput() {
  const i = process.argv.indexOf('--input')
  if (i === -1) return null
  const value = process.argv[i + 1]
  if (!value) throw new Error('Укажите путь после --input')
  return value
}

function clean(value) {
  if (value == null) return null
  const text = String(value).trim()
  return text || null
}

function makeId(word) {
  return `hsk30-${createHash('sha1')
    .update([word.level, word.hanzi, word.pinyin, word.meaning].join('\u0001'))
    .digest('hex')
    .slice(0, 16)}`
}

async function loadRaw() {
  const input = argInput()
  if (input) return JSON.parse(readFileSync(input, 'utf8'))
  const response = await fetch(SOURCE_URL)
  if (!response.ok) throw new Error(`Не удалось скачать список: ${response.status}`)
  return response.json()
}

const raw = await loadRaw()
if (!Array.isArray(raw.data)) throw new Error('В файле нет массива data')
if (raw.data.length !== EXPECTED_COUNT) {
  throw new Error(`Ожидалось ${EXPECTED_COUNT} слов, в файле ${raw.data.length}`)
}

const words = raw.data.map((row, index) => {
  const level = Number(row.level)
  const hanzi = clean(row.hanzi)
  const pinyin = clean(row.pinyin)
  const meaning = clean(row.meaning)
  if (!hanzi || !pinyin || !meaning || !Number.isInteger(level) || level < 1 || level > 9) {
    throw new Error(`Плохая строка ${index}: ${JSON.stringify(row).slice(0, 180)}`)
  }
  return {
    id: makeId({ level, hanzi, pinyin, meaning }),
    level,
    hanzi,
    pinyin,
    tones: clean(row.tones),
    meaning,
    exampleZh: clean(row.exampleChinese),
    examplePy: clean(row.examplePinyin),
    exampleEn: clean(row.exampleEnglish),
  }
})

const ids = new Set(words.map((word) => word.id))
if (ids.size !== words.length) throw new Error('Коллизия id — список не записан')

const dataset = {
  meta: {
    name: 'HSK 3.0 word list, all levels',
    wordCount: words.length,
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attribution: raw.attribution
      || 'HSK 3.0 word list, all levels by Gushi (https://gushichinese.com/hsk-3.0/downloads), CC BY-SA 4.0',
    sourceUrl: raw.page || 'https://gushichinese.com/hsk-3.0/downloads',
    downloadUrl: SOURCE_URL,
    updated: raw.updated || null,
    source: raw.source || null,
    sources: raw.sources || null,
    compiledBy: raw.compiledBy || null,
    changes: 'Repackaged for the HSK Slova app: added a stable id and renamed example fields. No words were added, removed, or rewritten. Levels 7–9 remain the publisher study split of the single official band.',
    levelCounts: words.reduce((counts, word) => {
      counts[word.level] = (counts[word.level] || 0) + 1
      return counts
    }, {}),
  },
  words,
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, `${JSON.stringify(dataset)}\n`)
console.log(`Wrote ${words.length} words to ${outPath}`)
