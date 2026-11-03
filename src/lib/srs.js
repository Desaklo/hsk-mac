/** SM-2-style scheduler. Grades: 1 again, 3 hard, 4 good, 5 easy. */

export const GRADE = { again: 1, hard: 3, good: 4, easy: 5 }
export const EASE_MIN = 1.3
export const EASE_START = 2.5
const DAY = 24 * 60 * 60 * 1000
const AGAIN_DELAY = 10 * 60 * 1000

function round2(value) {
  return Math.round(value * 100) / 100
}

export function blankCard() {
  return {
    ease: EASE_START,
    interval: 0,
    reps: 0,
    lapses: 0,
    due: 0,
    lastGrade: null,
    reviews: 0,
    correct: 0,
    incorrect: 0,
    lastReviewed: null,
  }
}

export function normalizeCard(card) {
  return { ...blankCard(), ...(card || {}) }
}

/**
 * Return the next card state. Does not mutate the input.
 * Again: lapse, ease −0.2, back in 10 minutes.
 * First success: 1 day (4 days if Easy). Second: 6 days (3 Hard, 10 Easy).
 * Later: interval × ease (Hard ×1.2, Easy × ease×1.3).
 */
export function review(card, grade, now = Date.now()) {
  const next = normalizeCard(card)
  if (![1, 3, 4, 5].includes(grade)) throw new Error(`Неизвестная оценка: ${grade}`)
  next.reviews += 1
  next.lastReviewed = now
  next.lastGrade = grade

  if (grade < 3) {
    next.incorrect += 1
    next.lapses += 1
    next.reps = 0
    next.interval = 0
    next.ease = Math.max(EASE_MIN, round2(next.ease - 0.2))
    next.due = now + AGAIN_DELAY
    return next
  }

  next.correct += 1
  if (grade === GRADE.hard) next.ease = Math.max(EASE_MIN, round2(next.ease - 0.15))
  if (grade === GRADE.easy) next.ease = round2(next.ease + 0.15)

  if (next.reps === 0) {
    next.interval = grade === GRADE.easy ? 4 : 1
  } else if (next.reps === 1) {
    next.interval = grade === GRADE.hard ? 3 : grade === GRADE.easy ? 10 : 6
  } else {
    const factor = grade === GRADE.hard ? 1.2 : grade === GRADE.easy ? next.ease * 1.3 : next.ease
    next.interval = Math.max(1, Math.round(next.interval * factor))
  }
  next.reps += 1
  next.due = now + next.interval * DAY
  return next
}
