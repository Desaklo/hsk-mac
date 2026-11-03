/** Quizzes are generated from the word list for each session. There is no fixed question bank. */
import { hanziMatches, pinyinMatches } from './pinyin.js'

export const QUIZ_TYPES = ['mixed', 'meaning', 'pinyin', 'hanzi', 'cloze', 'type-pinyin', 'type-hanzi']

export function mulberry32(seed) {
  let state = seed >>> 0
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffle(list, random) {
  const copy = list.slice()
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function clozeSentence(word) {
  const sentence = word?.exampleZh
  if (!sentence || !word.hanzi || !sentence.includes(word.hanzi)) return null
  const at = sentence.indexOf(word.hanzi)
  return {
    before: sentence.slice(0, at),
    after: sentence.slice(at + word.hanzi.length),
  }
}

function labelFor(word, type) {
  if (type === 'meaning') return word.meaning
  if (type === 'pinyin') return word.pinyin
  return word.hanzi
}

function relatedRank(target, other) {
  if (other.level !== target.level) return 100 + Math.abs(other.level - target.level)
  let shared = 0
  for (const char of target.hanzi) {
    if (other.hanzi.includes(char)) shared += 1
  }
  return Math.abs(target.hanzi.length - other.hanzi.length) * 2 - shared
}

function pickDistractors(target, type, pool, random) {
  const correct = labelFor(target, type)
  const ranked = []
  for (const word of pool) {
    if (word.id === target.id) continue
    if (labelFor(word, type) === correct) continue
    if ((type === 'hanzi' || type === 'cloze') && word.hanzi === target.hanzi) continue
    ranked.push({ word, score: relatedRank(target, word) + random() * 0.01 })
  }
  ranked.sort((a, b) => a.score - b.score)
  return ranked.slice(0, 3).map((item) => item.word)
}

function makeQuestion(word, type, pool, random) {
  if (type === 'type-pinyin' || type === 'type-hanzi') {
    return { wordId: word.id, type, choices: [] }
  }
  const distractors = pickDistractors(word, type, pool, random)
  const choices = shuffle([word, ...distractors], random).map((item) => ({
    wordId: item.id,
    label: labelFor(item, type),
  }))
  return { wordId: word.id, type, choices }
}

function resolveType(requested, index, word) {
  if (requested !== 'mixed') return requested
  const cycle = ['meaning', 'pinyin', 'hanzi', 'cloze']
  const type = cycle[index % cycle.length]
  if (type === 'cloze' && !clozeSentence(word)) return 'hanzi'
  return type
}

/**
 * @param {object[]} targets words the questions are about (already filtered)
 * @param {object} options count, type, seed, distractorsFrom
 */
export function generateQuiz(targets, options = {}) {
  const {
    count = 10,
    type = 'mixed',
    seed = 1,
    distractorsFrom = targets,
  } = options
  if (!QUIZ_TYPES.includes(type)) throw new Error(`Неизвестный тип теста: ${type}`)
  const random = mulberry32(seed >>> 0)
  const usable = (type === 'cloze'
    ? targets.filter((word) => clozeSentence(word))
    : targets.slice())
  const ordered = shuffle(usable, random)
  const questions = []
  for (const word of ordered) {
    if (questions.length >= count) break
    const questionType = resolveType(type, questions.length, word)
    if (questionType === 'cloze' && !clozeSentence(word)) continue
    questions.push(makeQuestion(word, questionType, distractorsFrom, random))
  }
  return questions
}

export function answerIsCorrect(question, word, response) {
  if (!question || !word) return false
  if (question.type === 'type-pinyin') return pinyinMatches(response, word.pinyin)
  if (question.type === 'type-hanzi') return hanziMatches(response, word.hanzi)
  return response === question.wordId
}
