import assert from 'node:assert/strict'
import { test } from 'node:test'
import { review } from '../src/lib/srs.js'
import { buildCardQueue, classify, filterWords, summarize } from '../src/lib/study.js'

function word(id, level = 1) {
  return { id, level, hanzi: id, pinyin: id, meaning: id }
}

test('a wrong answer is hard, and four calm goods become learned', () => {
  const failed = review(null, 1, 0)
  assert.deepEqual(classify(failed), { difficulty: 'hard', progress: 'hard' })

  let card = null
  for (let i = 0; i < 4; i += 1) card = review(card, 4, 0)
  assert.equal(card.interval >= 21, true)
  assert.deepEqual(classify(card), { difficulty: 'easy', progress: 'learned' })

  const once = review(null, 4, 0)
  assert.deepEqual(classify(once), { difficulty: 'medium', progress: 'reviewing' })
})

test('a later good answer lets a missed word leave the hard pile', () => {
  let card = review(null, 1, 0)
  card = review(card, 4, 0)
  assert.equal(classify(card).difficulty, 'medium')
})

test('level and difficulty filters', () => {
  const words = [word('a', 1), word('b', 2), word('c', 7), word('d', 9)]
  const cards = { a: review(null, 1, 0) }
  assert.deepEqual(filterWords(words, cards, { level: '2' }).map((item) => item.id), ['b'])
  assert.deepEqual(filterWords(words, cards, { level: '7-9' }).map((item) => item.id), ['c', 'd'])
  assert.deepEqual(filterWords(words, cards, { difficulty: 'hard' }).map((item) => item.id), ['a'])
  assert.deepEqual(filterWords(words, cards, { difficulty: 'new' }).map((item) => item.id), ['b', 'c', 'd'])
})

test('the default queue is due cards, then a limited batch of new ones', () => {
  const words = ['a', 'b', 'c', 'd'].map((id) => word(id))
  const cards = { a: review(null, 1, 0) }
  const dueNow = buildCardQueue(words, cards, { now: cards.a.due, sessionSize: 10, newLimit: 2 })
  assert.deepEqual(dueNow.queue.map((item) => item.id), ['a', 'b', 'c'])
  const notYet = buildCardQueue(words, cards, { now: 0, sessionSize: 10, newLimit: 2 })
  assert.deepEqual(notYet.queue.map((item) => item.id), ['b', 'c'])
})

test('hard only ignores the due date so the list can be practiced on purpose', () => {
  const words = [word('a'), word('b')]
  const cards = { a: review(null, 1, 0) }
  const queue = buildCardQueue(words, cards, { difficulty: 'hard', now: 0, sessionSize: 10 })
  assert.deepEqual(queue.queue.map((item) => item.id), ['a'])
  const stats = summarize(words, cards, 0)
  assert.equal(stats.hard, 1)
  assert.equal(stats.new, 1)
  assert.equal(stats.learned + stats.reviewing + stats.hard + stats.new, stats.total)
})
