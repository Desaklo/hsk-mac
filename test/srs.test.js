import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blankCard, EASE_MIN, review } from '../src/lib/srs.js'

const DAY = 24 * 60 * 60 * 1000

test('good reviews follow the 1, 6, then ease schedule', () => {
  let card = review(null, 4, 0)
  assert.equal(card.interval, 1)
  assert.equal(card.reps, 1)
  assert.equal(card.ease, 2.5)
  assert.equal(card.due, DAY)
  card = review(card, 4, 0)
  assert.equal(card.interval, 6)
  assert.equal(card.reps, 2)
  card = review(card, 4, 0)
  assert.equal(card.interval, 15)
  card = review(card, 4, 0)
  assert.equal(card.interval, 38)
  assert.equal(card.correct, 4)
  assert.equal(card.lapses, 0)
})

test('again lapses, drops ease, and returns in 10 minutes', () => {
  const card = review(null, 1, 1_000)
  assert.equal(card.reps, 0)
  assert.equal(card.lapses, 1)
  assert.equal(card.incorrect, 1)
  assert.equal(card.ease, 2.3)
  assert.equal(card.due, 1_000 + 10 * 60 * 1000)
  assert.equal(card.lastGrade, 1)
})

test('easy lengthens the first steps and raises ease', () => {
  let card = review(null, 5, 0)
  assert.equal(card.interval, 4)
  assert.equal(card.ease, 2.65)
  card = review(card, 5, 0)
  assert.equal(card.interval, 10)
  assert.equal(card.ease, 2.8)
})

test('ease never falls below 1.3 and the input card is not mutated', () => {
  const original = blankCard()
  const snapshot = { ...original }
  let card = original
  for (let i = 0; i < 20; i += 1) card = review(card, 1, 0)
  assert.equal(card.ease, EASE_MIN)
  assert.deepEqual(original, snapshot)
})
