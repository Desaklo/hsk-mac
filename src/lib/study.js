/** Filters, progress buckets, and flashcard queues. Pure functions. */

export function classify(card) {
  if (!card || !card.reviews) return { difficulty: 'new', progress: 'new' }
  // Hard: the last answer was wrong, ease has collapsed, or the word is still
  // marked difficult and has not had two successful reviews since.
  const hard = card.lastGrade < 3
    || card.ease < 1.8
    || (card.lapses >= 2 && card.lastGrade === 3 && card.reps < 2)
  if (hard) return { difficulty: 'hard', progress: 'hard' }
  const easy = card.reps >= 2 && card.ease >= 2.2 && card.lastGrade >= 4
  if (easy && card.interval >= 21) return { difficulty: 'easy', progress: 'learned' }
  if (easy) return { difficulty: 'easy', progress: 'reviewing' }
  return { difficulty: 'medium', progress: 'reviewing' }
}

export function matchesLevel(word, level) {
  if (!level || level === 'all') return true
  if (level === '7-9') return word.level >= 7 && word.level <= 9
  return word.level === Number(level)
}

export function filterWords(words, cards, { level = 'all', difficulty = 'all' } = {}) {
  return words.filter((word) => {
    if (!matchesLevel(word, level)) return false
    if (difficulty === 'all') return true
    return classify(cards?.[word.id]).difficulty === difficulty
  })
}

export function summarize(words, cards, now = Date.now()) {
  const stats = {
    total: words.length,
    new: 0,
    easy: 0,
    medium: 0,
    hard: 0,
    learned: 0,
    reviewing: 0,
    due: 0,
    correct: 0,
    incorrect: 0,
  }
  for (const word of words) {
    const card = cards?.[word.id]
    const kind = classify(card)
    stats[kind.difficulty] += 1
    if (kind.progress === 'learned') stats.learned += 1
    else if (kind.progress === 'reviewing') stats.reviewing += 1
    if (card?.reviews && card.due <= now) stats.due += 1
    stats.correct += card?.correct || 0
    stats.incorrect += card?.incorrect || 0
  }
  return stats
}

export function summarizeLevels(words, cards, now = Date.now()) {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => ({
    level,
    ...summarize(words.filter((word) => word.level === level), cards, now),
  }))
}

export function hardWords(words, cards, level = 'all') {
  return filterWords(words, cards, { level, difficulty: 'hard' }).sort((a, b) => {
    const left = cards?.[a.id]
    const right = cards?.[b.id]
    return ((right?.lapses || 0) - (left?.lapses || 0))
      || ((right?.lastReviewed || 0) - (left?.lastReviewed || 0))
  })
}

/**
 * Build one flashcard sitting.
 * "all": due cards first (hard ones before the rest), then new cards.
 * A named difficulty: that pile, least recently seen first, ignoring the due date
 * so "hard only" can be practiced on purpose.
 */
export function buildCardQueue(words, cards, {
  level = 'all',
  difficulty = 'all',
  now = Date.now(),
  sessionSize = 20,
  newLimit = 15,
} = {}) {
  const pool = filterWords(words, cards, { level, difficulty })
  if (difficulty !== 'all' && difficulty !== 'new') {
    const ordered = pool.slice().sort((a, b) => (cards[a.id]?.lastReviewed || 0) - (cards[b.id]?.lastReviewed || 0))
    const queue = ordered.slice(0, sessionSize)
    return {
      queue,
      total: ordered.length,
      due: ordered.length,
      fresh: 0,
      remaining: Math.max(0, ordered.length - queue.length),
    }
  }

  const due = []
  const fresh = []
  for (const word of pool) {
    const card = cards?.[word.id]
    if (!card || !card.reviews) fresh.push(word)
    else if (card.due <= now) due.push(word)
  }
  due.sort((a, b) => {
    const aHard = classify(cards[a.id]).difficulty === 'hard' ? 0 : 1
    const bHard = classify(cards[b.id]).difficulty === 'hard' ? 0 : 1
    if (aHard !== bHard) return aHard - bHard
    return (cards[a.id].due || 0) - (cards[b.id].due || 0)
  })
  const duePart = due.slice(0, sessionSize)
  const room = difficulty === 'new'
    ? sessionSize
    : Math.min(newLimit, sessionSize - duePart.length)
  const newPart = fresh.slice(0, Math.max(0, room))
  const queue = difficulty === 'new' ? newPart : duePart.concat(newPart)
  return {
    queue,
    total: (difficulty === 'new' ? fresh.length : due.length + fresh.length),
    due: due.length,
    fresh: newPart.length,
    remaining: difficulty === 'new'
      ? Math.max(0, fresh.length - newPart.length)
      : Math.max(0, due.length - duePart.length) + Math.max(0, fresh.length - newPart.length),
  }
}
