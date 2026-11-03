import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { clozeSentence, generateQuiz } from '../src/lib/quiz.js'
import { filterWords } from '../src/lib/study.js'

const dataset = JSON.parse(readFileSync(new URL('../data/hsk30.json', import.meta.url), 'utf8'))

test('the embedded list is the 11,000-word HSK 3.0 syllabus snapshot', () => {
  assert.equal(dataset.words.length, 11000)
  assert.equal(dataset.meta.license, 'CC BY-SA 4.0')
  assert.match(dataset.meta.attribution, /Gushi/)
  assert.match(dataset.meta.sourceUrl, /gushichinese\.com/)
  const counts = {}
  const ids = new Set()
  for (const word of dataset.words) {
    assert.ok(word.id && word.hanzi && word.pinyin && word.meaning)
    assert.ok(word.level >= 1 && word.level <= 9)
    counts[word.level] = (counts[word.level] || 0) + 1
    ids.add(word.id)
  }
  assert.equal(ids.size, 11000)
  assert.deepEqual(counts, {
    1: 300,
    2: 200,
    3: 500,
    4: 1000,
    5: 1600,
    6: 1800,
    7: 1867,
    8: 1867,
    9: 1866,
  })
  const love = dataset.words.find((word) => word.hanzi === '爱' && word.level === 1)
  assert.equal(love.pinyin, 'ài')
  assert.equal(love.meaning, 'to love')
  assert.equal(love.exampleZh, '真可爱！')
})

test('a generated HSK 1 quiz uses real list rows and can blank an example', () => {
  const level1 = filterWords(dataset.words, {}, { level: '1' })
  assert.equal(level1.length, 300)
  assert.equal(level1.every((word) => clozeSentence(word)), true)
  const questions = generateQuiz(level1, { count: 8, type: 'mixed', seed: 42, distractorsFrom: level1 })
  assert.equal(questions.length, 8)
  assert.equal(questions.some((question) => question.type === 'cloze'), true)
  for (const question of questions) {
    const word = level1.find((item) => item.id === question.wordId)
    assert.ok(word)
    if (question.choices.length) {
      assert.equal(question.choices.some((choice) => choice.wordId === word.id), true)
      assert.equal(new Set(question.choices.map((choice) => choice.label)).size, question.choices.length)
    }
  }
})
