import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultProgress, isProgressFile, normalizeProgress } from '../src/lib/storage.js'

test('broken settings fall back to the beginner defaults', () => {
  const progress = normalizeProgress({
    version: 1,
    settings: { level: 'nope', quizCount: 999, textSize: 'xl' },
    cards: { a: { reviews: 1 } },
  })
  assert.equal(progress.settings.level, '1')
  assert.equal(progress.settings.quizCount, 10)
  assert.equal(progress.settings.textSize, 'l')
  assert.equal(progress.cards.a.reviews, 1)
  assert.equal(isProgressFile(progress), true)
  assert.equal(isProgressFile(defaultProgress()), true)
  assert.equal(isProgressFile({ hello: 'no' }), false)
  assert.deepEqual(normalizeProgress(null).settings.level, '1')
})
