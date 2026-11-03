import assert from 'node:assert/strict'
import { test } from 'node:test'
import { answerIsCorrect, clozeSentence, generateQuiz } from '../src/lib/quiz.js'
import { hanziMatches, pinyinMatches } from '../src/lib/pinyin.js'

function word(n, extra = {}) {
  const hanzi = String.fromCodePoint(0x4e00 + n)
  return {
    id: `w${n}`,
    level: 1,
    hanzi,
    pinyin: `pin${n}`,
    meaning: `meaning ${n}`,
    exampleZh: `前${hanzi}后`,
    examplePy: '',
    exampleEn: '',
    ...extra,
  }
}

const words = Array.from({ length: 12 }, (_, index) => word(index + 1))

test('the same seed rebuilds the same quiz and a new seed does not', () => {
  const first = generateQuiz(words, { count: 4, type: 'meaning', seed: 7 })
  const again = generateQuiz(words, { count: 4, type: 'meaning', seed: 7 })
  const other = generateQuiz(words, { count: 4, type: 'meaning', seed: 8 })
  assert.deepEqual(first, again)
  assert.notDeepEqual(first.map((question) => question.wordId), other.map((question) => question.wordId))
})

test('multiple choice keeps the right answer and unique labels', () => {
  for (const type of ['meaning', 'pinyin', 'hanzi', 'cloze']) {
    const questions = generateQuiz(words, { count: 6, type, seed: 3 })
    assert.equal(questions.length, 6)
    for (const question of questions) {
      assert.equal(question.type, type)
      assert.equal(question.choices.length, 4)
      assert.equal(new Set(question.choices.map((choice) => choice.label)).size, 4)
      assert.equal(question.choices.some((choice) => choice.wordId === question.wordId), true)
    }
  }
})

test('distractors prefer a word that shares a character', () => {
  const target = word(1, { hanzi: '明', meaning: 'bright' })
  const related = word(2, { hanzi: '明天', meaning: 'tomorrow' })
  const others = Array.from({ length: 8 }, (_, index) => word(20 + index, { hanzi: `字${index}` }))
  const [question] = generateQuiz([target], {
    count: 1,
    type: 'hanzi',
    seed: 1,
    distractorsFrom: [target, related, ...others],
  })
  assert.equal(question.choices.some((choice) => choice.wordId === related.id), true)
})

test('a cloze hides the target and typing accepts tone-free pinyin', () => {
  const target = words[0]
  const cloze = clozeSentence(target)
  assert.equal(cloze.before.includes(target.hanzi), false)
  assert.equal(cloze.after.includes(target.hanzi), false)
  assert.equal(`${cloze.before}${target.hanzi}${cloze.after}`, target.exampleZh)

  const [typed] = generateQuiz(words, { count: 1, type: 'type-pinyin', seed: 1 })
  assert.deepEqual(typed.choices, [])
  assert.equal(answerIsCorrect(typed, target, 'pin1'), true)
  assert.equal(answerIsCorrect(typed, target, 'nope'), false)
  assert.equal(pinyinMatches('ai', 'ài'), true)
  assert.equal(pinyinMatches('ai4', 'ài'), true)
  assert.equal(pinyinMatches('dou', 'dū, dōu'), true)
  assert.equal(pinyinMatches('a', 'ài'), false)
  assert.equal(hanziMatches('你 好', '你好'), true)
})

test('mixed quizzes substitute hanzi when a word has no example', () => {
  const bare = word(30, { exampleZh: null })
  const questions = generateQuiz([bare, ...words], { count: 4, type: 'mixed', seed: 2 })
  assert.equal(questions.length, 4)
  assert.equal(questions.every((question) => question.type !== 'cloze' || clozeSentence(words.find((item) => item.id === question.wordId) || bare)), true)
})
