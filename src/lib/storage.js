const LEVELS = ['all', '1', '2', '3', '4', '5', '6', '7', '8', '9', '7-9']
const DIFFICULTIES = ['all', 'new', 'easy', 'medium', 'hard']
const QUIZ_COUNTS = [5, 10, 20]
const QUIZ_TYPES = ['mixed', 'meaning', 'pinyin', 'hanzi', 'cloze', 'type-pinyin', 'type-hanzi']
const TEXT_SIZES = ['s', 'm', 'l']
const SESSION_SIZES = [10, 20, 30]
const NEW_LIMITS = [5, 10, 15, 20]

export function defaultProgress() {
  return {
    version: 1,
    settings: {
      level: '1',
      difficulty: 'all',
      quizCount: 10,
      quizType: 'mixed',
      textSize: 'l',
      newLimit: 15,
      sessionSize: 20,
      introSeen: false,
    },
    cards: {},
  }
}

function oneOf(allowed, value, fallback) {
  return allowed.includes(value) ? value : fallback
}

function oneOfNumber(allowed, value, fallback) {
  const number = Number(value)
  return allowed.includes(number) ? number : fallback
}

export function normalizeProgress(raw) {
  const base = defaultProgress()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {}
  const cards = raw.cards && typeof raw.cards === 'object' && !Array.isArray(raw.cards) ? raw.cards : {}
  return {
    version: 1,
    settings: {
      level: oneOf(LEVELS, settings.level, base.settings.level),
      difficulty: oneOf(DIFFICULTIES, settings.difficulty, base.settings.difficulty),
      quizCount: oneOfNumber(QUIZ_COUNTS, settings.quizCount, base.settings.quizCount),
      quizType: oneOf(QUIZ_TYPES, settings.quizType, base.settings.quizType),
      textSize: oneOf(TEXT_SIZES, settings.textSize, base.settings.textSize),
      newLimit: oneOfNumber(NEW_LIMITS, settings.newLimit, base.settings.newLimit),
      sessionSize: oneOfNumber(SESSION_SIZES, settings.sessionSize, base.settings.sessionSize),
      introSeen: Boolean(settings.introSeen),
    },
    cards,
  }
}

export function isProgressFile(raw) {
  return Boolean(
    raw
    && typeof raw === 'object'
    && !Array.isArray(raw)
    && raw.version === 1
    && raw.cards
    && typeof raw.cards === 'object'
    && !Array.isArray(raw.cards),
  )
}
