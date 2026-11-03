import { GRADE, review } from './lib/srs.js'
import { answerIsCorrect, clozeSentence, generateQuiz } from './lib/quiz.js'
import { normalizePinyin } from './lib/pinyin.js'
import {
  buildCardQueue,
  classify,
  filterWords,
  hardWords,
  summarize,
  summarizeLevels,
} from './lib/study.js'
import { defaultProgress, isProgressFile, normalizeProgress } from './lib/storage.js'

const app = document.querySelector('#app')
const state = {
  words: [],
  byId: new Map(),
  meta: null,
  progress: defaultProgress(),
  screen: 'cards',
  queue: [],
  queueMeta: null,
  queueIndex: 0,
  queueBuilt: false,
  revealed: false,
  requeues: {},
  sessionStats: emptyStats(),
  quiz: null,
  hardQuery: '',
  banner: '',
  focus: null,
}

function emptyStats() {
  return { again: 0, hard: 0, good: 0, easy: 0 }
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]))
}

function formatCount(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

function levelName(level) {
  if (level >= 7) return `7–9, часть ${level - 6}`
  return `HSK ${level}`
}

function levelOptionLabel(value) {
  const labels = {
    all: 'Все уровни',
    1: 'HSK 1',
    2: 'HSK 2',
    3: 'HSK 3',
    4: 'HSK 4',
    5: 'HSK 5',
    6: 'HSK 6',
    '7-9': 'HSK 7–9 (весь экзамен)',
    7: 'HSK 7–9, часть 1',
    8: 'HSK 7–9, часть 2',
    9: 'HSK 7–9, часть 3',
  }
  return labels[value] || value
}

function difficultyLabel(value) {
  return {
    all: 'Все',
    new: 'Новые',
    easy: 'Лёгкие',
    medium: 'Средние',
    hard: 'Сложные',
  }[value] || value
}

function personalLabel(kind) {
  return { new: 'новое', easy: 'лёгкое', medium: 'среднее', hard: 'сложное' }[kind] || kind
}

async function loadDataset() {
  if (window.hsk?.loadDataset) return window.hsk.loadDataset()
  const response = await fetch(new URL('../data/hsk30.json', import.meta.url))
  if (!response.ok) throw new Error('словарь не открылся')
  return response.json()
}

async function loadProgress() {
  if (window.hsk?.loadProgress) return window.hsk.loadProgress()
  try {
    const saved = localStorage.getItem('hsk-slova-progress')
    return saved ? JSON.parse(saved) : null
  } catch {
    return null
  }
}

function persist() {
  clearTimeout(persist.timer)
  const payload = state.progress
  persist.timer = setTimeout(() => {
    if (window.hsk?.saveProgress) {
      window.hsk.saveProgress(payload).catch((error) => console.error(error))
      return
    }
    localStorage.setItem('hsk-slova-progress', JSON.stringify(payload))
  }, 150)
}

function updateSetting(key, value) {
  state.progress.settings[key] = value
  if (key === 'textSize') document.body.dataset.size = value
  if (key === 'level' || key === 'difficulty' || key === 'newLimit' || key === 'sessionSize') {
    state.queueBuilt = false
    if (!state.quiz || state.quiz.phase === 'done' || state.quiz.phase === 'empty') state.quiz = null
  }
  persist()
  render()
}

function ensureQueue() {
  if (state.queueBuilt) return
  const settings = state.progress.settings
  state.queueMeta = buildCardQueue(state.words, state.progress.cards, {
    level: settings.level,
    difficulty: settings.difficulty,
    sessionSize: settings.sessionSize,
    newLimit: settings.newLimit,
  })
  state.queue = state.queueMeta.queue
  state.queueIndex = 0
  state.revealed = false
  state.requeues = {}
  state.sessionStats = emptyStats()
  state.queueBuilt = true
}

function gradeCurrent(grade) {
  const word = state.queue[state.queueIndex]
  if (!word) return
  if (grade !== GRADE.again && !state.revealed) return
  state.progress.cards[word.id] = review(state.progress.cards[word.id], grade, Date.now())
  const bucket = { 1: 'again', 3: 'hard', 4: 'good', 5: 'easy' }[grade]
  state.sessionStats[bucket] += 1
  if (grade < 3) {
    state.requeues[word.id] = (state.requeues[word.id] || 0) + 1
    const later = state.queue.slice(state.queueIndex + 1)
    if (state.requeues[word.id] <= 2 && !later.some((item) => item.id === word.id)) {
      state.queue.splice(Math.min(state.queue.length, state.queueIndex + 4), 0, word)
    }
  }
  state.queueIndex += 1
  state.revealed = false
  persist()
  render()
}

function startQuiz() {
  const settings = state.progress.settings
  const targets = filterWords(state.words, state.progress.cards, {
    level: settings.level,
    difficulty: settings.difficulty,
  })
  const band = filterWords(state.words, state.progress.cards, {
    level: settings.level,
    difficulty: 'all',
  })
  const questions = generateQuiz(targets, {
    count: settings.quizCount,
    type: settings.quizType,
    seed: Date.now() % 2147483647,
    distractorsFrom: band.length >= 4 ? band : state.words,
  })
  state.quiz = {
    questions,
    index: 0,
    phase: questions.length ? 'answer' : 'empty',
    pickedId: null,
    typed: '',
    correct: null,
    results: [],
    hint: '',
    type: settings.quizType,
    level: settings.level,
    difficulty: settings.difficulty,
  }
  render()
}

function commitQuizAnswer(response) {
  const quiz = state.quiz
  if (!quiz || quiz.phase !== 'answer') return
  const question = quiz.questions[quiz.index]
  const word = state.byId.get(question.wordId)
  const ok = answerIsCorrect(question, word, response)
  quiz.pickedId = String(question.type).startsWith('type-') ? null : response
  quiz.typed = String(question.type).startsWith('type-') ? String(response ?? '') : ''
  quiz.correct = ok
  quiz.phase = 'feedback'
  quiz.results.push({ wordId: word.id, ok })
  state.progress.cards[word.id] = review(
    state.progress.cards[word.id],
    ok ? GRADE.good : GRADE.again,
    Date.now(),
  )
  persist()
  render()
}

function nextQuestion() {
  const quiz = state.quiz
  quiz.index += 1
  quiz.pickedId = null
  quiz.correct = null
  quiz.typed = ''
  quiz.hint = ''
  quiz.phase = quiz.index >= quiz.questions.length ? 'done' : 'answer'
  render()
}

function studyWords(words) {
  state.queue = words
  state.queueMeta = { queue: words, total: words.length, due: words.length, fresh: 0, remaining: 0 }
  state.queueIndex = 0
  state.revealed = false
  state.requeues = {}
  state.sessionStats = emptyStats()
  state.queueBuilt = true
  state.screen = 'cards'
  render()
}

function speak(text) {
  if (!text || !window.speechSynthesis) {
    state.banner = 'Озвучка на этом компьютере недоступна. На Mac её даёт голос «Китайский».'
    render()
    return
  }
  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = 'zh-CN'
  utter.rate = 0.85
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utter)
}

function selectBox(id, value, options) {
  const items = options.map(([optionValue, label]) => (
    `<option value="${esc(optionValue)}"${String(optionValue) === String(value) ? ' selected' : ''}>${esc(label)}</option>`
  )).join('')
  return `<select id="${id}">${items}</select>`
}

function wordDetails(word) {
  const example = word.exampleZh ? `
    <div class="example">
      <p class="meaning-label">Пример</p>
      <p class="example-zh" lang="zh-Hans">${esc(word.exampleZh)}</p>
      ${word.examplePy ? `<p class="example-py">${esc(word.examplePy)}</p>` : ''}
      ${word.exampleEn ? `<p class="example-en">${esc(word.exampleEn)}</p>` : ''}
      <button type="button" class="ghost" data-action="speak" data-what="example">Слушать пример</button>
    </div>` : ''
  return `
    <p class="pinyin">${esc(word.pinyin)}</p>
    <p class="meaning-label">Значение <span class="lang-tag">английский</span></p>
    <p class="meaning">${esc(word.meaning)}</p>
    ${example}
  `
}

function shell() {
  const settings = state.progress.settings
  const cards = state.progress.cards
  const levelWords = filterWords(state.words, cards, { level: settings.level, difficulty: 'all' })
  const stats = summarize(levelWords, cards)
  const nav = [
    ['cards', 'Карточки'],
    ['quiz', 'Тест'],
    ['hard', 'Сложные'],
    ['stats', 'Прогресс'],
  ].map(([id, label]) => (
    `<button type="button" data-nav="${id}" ${state.screen === id ? 'aria-current="page"' : ''}>${label}</button>`
  )).join('')

  return `
    <header>
      <div class="top">
        <div class="brand">
          <div class="brand-mark" lang="zh-Hans">汉</div>
          <div>
            <h1>HSK Слова</h1>
            <p class="tag">Карточки и тесты по HSK 3.0. Интернет не нужен.</p>
          </div>
        </div>
        <div class="filters">
          <label class="field">Уровень
            ${selectBox('level-select', settings.level, [
              ['all', 'Все уровни'], ['1', 'HSK 1'], ['2', 'HSK 2'], ['3', 'HSK 3'],
              ['4', 'HSK 4'], ['5', 'HSK 5'], ['6', 'HSK 6'],
              ['7-9', 'HSK 7–9 (весь экзамен)'],
              ['7', 'HSK 7–9, часть 1'], ['8', 'HSK 7–9, часть 2'], ['9', 'HSK 7–9, часть 3'],
            ])}
          </label>
          <label class="field">Какие слова
            ${selectBox('difficulty-select', settings.difficulty, [
              ['all', 'Все'], ['new', 'Новые'], ['easy', 'Лёгкие'], ['medium', 'Средние'], ['hard', 'Сложные'],
            ])}
          </label>
          <div class="text-size">
            <button type="button" data-action="text-smaller" aria-label="Мельче">A−</button>
            <button type="button" data-action="text-larger" aria-label="Крупнее">A+</button>
          </div>
        </div>
      </div>
      <nav class="nav">${nav}</nav>
      <div class="stats">
        <span class="chip" id="stat-total"><b>${formatCount(stats.total)}</b> в уровне</span>
        <span class="chip" id="stat-new"><b>${formatCount(stats.new)}</b> новых</span>
        <span class="chip" id="stat-reviewing"><b>${formatCount(stats.reviewing)}</b> повторяются</span>
        <span class="chip" id="stat-learned"><b>${formatCount(stats.learned)}</b> выучены</span>
        <span class="chip" id="stat-hard"><b>${formatCount(stats.hard)}</b> сложных</span>
        <span class="chip"><b>${formatCount(stats.due)}</b> к повторению</span>
      </div>
    </header>
    <main>
      ${state.banner ? `<div class="panel"><p class="banner">${esc(state.banner)}</p></div>` : ''}
      <div class="panel">${screenBody()}</div>
    </main>
  `
}

function screenBody() {
  if (state.screen === 'quiz') return quizScreen()
  if (state.screen === 'hard') return hardScreen()
  if (state.screen === 'stats') return statsScreen()
  return cardsScreen()
}

function cardsScreen() {
  ensureQueue()
  const settings = state.progress.settings
  const intro = settings.introSeen ? '' : `
    <div class="intro">
      <p>Нажмите «Показать ответ» и выберите, насколько слово знакомо. Программа сама решит, когда его повторить.</p>
      <button type="button" class="primary" data-action="dismiss-intro">Понятно</button>
    </div>`
  const scope = `${levelOptionLabel(settings.level)} · ${difficultyLabel(settings.difficulty).toLowerCase()}`
  if (state.queue.length === 0) {
    const caughtUp = state.queueMeta && state.queueMeta.total === 0 && (settings.difficulty === 'all' || settings.difficulty === 'new')
    return `${intro}
      <section class="empty">
        <h2>${caughtUp ? 'На сегодня всё' : 'Таких слов нет'}</h2>
        <p>${caughtUp
          ? 'Пора повторять ещё не наступила, и новые слова в этом уровне закончились. Можно пройти тест или заглянуть в сложные.'
          : 'В выбранном уровне нет слов с такой отметкой. Поставьте «Все» или другой уровень.'}</p>
        <div class="end-actions">
          <button type="button" class="primary" data-nav="quiz">Открыть тест</button>
          <button type="button" class="ghost" data-action="practice-hard">Сложные слова</button>
        </div>
      </section>`
  }
  if (state.queueIndex >= state.queue.length) {
    const stats = state.sessionStats
    return `${intro}
      <section class="empty">
        <h2>Серия закончилась</h2>
        <p>Не знаю: ${stats.again}. Трудно: ${stats.hard}. Знаю: ${stats.good}. Легко: ${stats.easy}.</p>
        <div class="end-actions">
          <button type="button" class="primary" data-action="next-series">Ещё серия</button>
          <button type="button" class="ghost" data-nav="quiz">Тест</button>
          <button type="button" class="ghost" data-action="practice-hard">Сложные слова</button>
        </div>
      </section>`
  }
  const word = state.queue[state.queueIndex]
  const kind = classify(state.progress.cards[word.id])
  const done = state.queueIndex
  const total = state.queue.length
  const width = Math.round((done / total) * 100)
  const revealed = state.revealed
  return `${intro}
    <article class="card" data-revealed="${revealed ? '1' : '0'}" data-word-id="${esc(word.id)}">
      <div class="kicker">
        <span>${esc(scope)}</span>
        <span>
          <button type="button" class="ghost tiny" data-action="speak" data-what="word">Слушать</button>
          ${done + 1} из ${total}${state.queueMeta?.remaining ? ` · ещё ${state.queueMeta.remaining}` : ''}
        </span>
      </div>
      <div class="bar" aria-hidden="true"><span style="width:${width}%"></span></div>
      <div class="badges">
        <span class="badge">${esc(levelName(word.level))}</span>
        <span class="badge ${esc(kind.difficulty)}">${esc(personalLabel(kind.difficulty))}</span>
      </div>
      <div class="hanzi-row">
        <div class="hanzi" lang="zh-Hans">${esc(word.hanzi)}</div>
      </div>
      ${revealed ? `<div class="details">${wordDetails(word)}</div>` : `
        <p class="hidden-answer">Ответ скрыт</p>
        <div class="actions" style="justify-content:center">
          <button type="button" class="primary" data-action="reveal">Показать ответ</button>
        </div>`}
    </article>
    <div class="dock">
      <div class="grades">
        <button type="button" class="grade again" data-action="grade" data-grade="1">Не знаю</button>
        <button type="button" class="grade hard" data-action="grade" data-grade="3" ${revealed ? '' : 'disabled'}>Трудно</button>
        <button type="button" class="grade good" data-action="grade" data-grade="4" ${revealed ? '' : 'disabled'}>Знаю</button>
        <button type="button" class="grade easy" data-action="grade" data-grade="5" ${revealed ? '' : 'disabled'}>Легко</button>
      </div>
      <p class="hint">Пробел — ответ. Клавиши 1–4 — не знаю, трудно, знаю, легко.</p>
    </div>`
}

function quizScreen() {
  const settings = state.progress.settings
  const pool = filterWords(state.words, state.progress.cards, {
    level: settings.level,
    difficulty: settings.difficulty,
  })
  if (!state.quiz) return quizSetup(pool)
  if (state.quiz.phase === 'empty') {
    return `<section class="empty">
      <h2>Тест не собрался</h2>
      <p>${settings.quizType === 'cloze'
        ? 'В этой выборке нет примеров, куда можно поставить пропуск. Выберите другой тип или другой уровень.'
        : 'В этой выборке нет слов. Смените уровень или отметку сложности.'}</p>
      <div class="end-actions"><button type="button" class="primary" data-action="clear-quiz">Назад</button></div>
    </section>`
  }
  if (state.quiz.phase === 'done') return quizDone()
  return quizQuestion(pool)
}

function quizSetup(pool) {
  const settings = state.progress.settings
  const typeHint = {
    'type-hanzi': 'Чтобы вписать иероглиф, на Mac добавьте китайскую клавиатуру: Системные настройки → Клавиатура → Источники ввода → Китайский, упрощённый.',
    'type-pinyin': 'Тон можно не ставить: ai и ài оба засчитываются. Правильный тон покажется после ответа.',
    cloze: 'В предложении из списка спрятано слово. Нужно выбрать, какое.',
    mixed: 'Вопросы каждый раз новые: значение, пиньинь, иероглиф и пропуск в предложении.',
  }[settings.quizType] || 'Варианты ответа берутся из слов того же уровня.'
  return `<section class="quiz-card setup">
    <h2>Новый тест</h2>
    <p>Вопросы собираются заново из списка, готового набора нет. Сейчас в выборке: <b>${formatCount(pool.length)}</b> (${esc(levelOptionLabel(settings.level))}, ${esc(difficultyLabel(settings.difficulty).toLowerCase())}).</p>
    <div class="row">
      <label class="field">Сколько вопросов
        ${selectBox('quiz-count', settings.quizCount, [['5', '5'], ['10', '10'], ['20', '20']])}
      </label>
      <label class="field">Тип
        ${selectBox('quiz-type', settings.quizType, [
          ['mixed', 'Смешанный'],
          ['meaning', 'Значение'],
          ['pinyin', 'Пиньинь'],
          ['hanzi', 'Иероглиф'],
          ['cloze', 'Пропуск в предложении'],
          ['type-pinyin', 'Вписать пиньинь'],
          ['type-hanzi', 'Вписать иероглиф'],
        ])}
      </label>
    </div>
    <p class="hint" style="text-align:left">${esc(typeHint)} Верные и неверные ответы тоже попадают в повторения.</p>
    <div class="actions">
      <button type="button" class="primary" data-action="start-quiz" ${pool.length ? '' : 'disabled'}>Собрать тест</button>
    </div>
  </section>`
}

function quizQuestion() {
  const quiz = state.quiz
  const question = quiz.questions[quiz.index]
  const word = state.byId.get(question.wordId)
  const cloze = clozeSentence(word)
  const titles = {
    meaning: 'Что означает слово?',
    pinyin: 'Какой у слова пиньинь?',
    hanzi: 'Какой это иероглиф?',
    cloze: 'Какое слово пропущено?',
    'type-pinyin': 'Впишите пиньинь',
    'type-hanzi': 'Впишите иероглиф',
  }
  let prompt = ''
  if (question.type === 'meaning' || question.type === 'pinyin') {
    prompt = `<div class="hanzi-row"><div class="hanzi" lang="zh-Hans">${esc(word.hanzi)}</div></div>`
  } else if (question.type === 'hanzi' || question.type === 'type-hanzi') {
    prompt = `<p class="prompt-meaning">${esc(word.meaning)}</p>${question.type === 'type-hanzi' ? `<p class="prompt-pinyin">${esc(word.pinyin)}</p>` : ''}`
  } else if (question.type === 'type-pinyin') {
    prompt = `<div class="hanzi" lang="zh-Hans">${esc(word.hanzi)}</div><p class="prompt-meaning">${esc(word.meaning)}</p>`
  } else if (cloze) {
    prompt = `<p class="cloze" lang="zh-Hans">${esc(cloze.before)}<span class="blank">____</span>${esc(cloze.after)}</p>`
  }
  const hanziChoice = question.type === 'hanzi' || question.type === 'cloze'
  const choices = question.choices.map((choice) => {
    let cls = hanziChoice ? 'choice hanzi-choice' : 'choice'
    if (quiz.phase === 'feedback') {
      if (choice.wordId === question.wordId) cls += ' correct'
      else if (choice.wordId === quiz.pickedId) cls += ' wrong'
    }
    const disabled = quiz.phase === 'feedback' ? 'disabled' : ''
    return `<button type="button" class="${cls}" data-action="choose" data-word-id="${esc(choice.wordId)}" ${disabled}>${esc(choice.label)}</button>`
  }).join('')
  const typing = question.type === 'type-pinyin' || question.type === 'type-hanzi'
  const input = typing && quiz.phase === 'answer' ? `
    <form data-action="check-type" class="type-row">
      <input id="quiz-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"
        lang="${question.type === 'type-hanzi' ? 'zh-Hans' : 'zh'}"
        class="${question.type === 'type-hanzi' ? 'hanzi-input' : ''}"
        placeholder="${question.type === 'type-hanzi' ? 'иероглиф' : 'pinyin'}" />
      <button type="submit" class="primary">Проверить</button>
    </form>
    ${quiz.hint ? `<p class="hint">${esc(quiz.hint)}</p>` : ''}` : ''
  const feedback = quiz.phase === 'feedback' ? `
    <div class="feedback ${quiz.correct ? 'ok' : 'bad'}">
      <strong>${quiz.correct ? 'Верно' : 'Неверно'}</strong>
      ${wordDetails(word)}
      <div class="actions"><button type="button" class="primary" data-action="quiz-next">${quiz.index + 1 >= quiz.questions.length ? 'К результатам' : 'Дальше'}</button></div>
    </div>` : `<div class="actions"><button type="button" class="ghost" data-action="quiz-skip">Не помню</button></div>`
  return `<section class="quiz-card">
    <div class="kicker"><span>${esc(titles[question.type] || 'Вопрос')}</span><span>${quiz.index + 1} из ${quiz.questions.length}</span></div>
    <div class="bar"><span style="width:${Math.round((quiz.index / quiz.questions.length) * 100)}%"></span></div>
    ${prompt}
    <div class="choices">${choices}</div>
    ${input}
    ${feedback}
  </section>`
}

function quizDone() {
  const results = state.quiz.results
  const correct = results.filter((item) => item.ok).length
  const missed = results.filter((item) => !item.ok)
  const items = missed.map((item) => {
    const word = state.byId.get(item.wordId)
    return `<li><span class="row-hanzi" lang="zh-Hans">${esc(word.hanzi)}</span> ${esc(word.pinyin)} — ${esc(word.meaning)}</li>`
  }).join('')
  return `<section class="quiz-card">
    <h2>Результат</h2>
    <p class="score">${correct} из ${results.length}</p>
    <p class="hint">Ошибки записаны как сложные и вернутся в карточках.</p>
    ${missed.length ? `<h3>Ошибки</h3><ul class="miss-list">${items}</ul>` : '<p>Без ошибок. Можно взять следующий набор.</p>'}
    <div class="end-actions">
      <button type="button" class="primary" data-action="start-quiz">Новый тест</button>
      ${missed.length ? '<button type="button" class="ghost" data-action="study-missed">Учить ошибки</button>' : ''}
    </div>
  </section>`
}

function hardScreen() {
  const settings = state.progress.settings
  const all = hardWords(state.words, state.progress.cards, settings.level)
  const query = state.hardQuery.trim()
  const q = query.toLowerCase()
  const qPy = normalizePinyin(query)
  const filtered = all.filter((word) => {
    if (!q) return true
    return word.hanzi.includes(query)
      || word.pinyin.toLowerCase().includes(q)
      || word.meaning.toLowerCase().includes(q)
      || (qPy && normalizePinyin(word.pinyin).includes(qPy))
  })
  const shown = filtered.slice(0, 200)
  if (!all.length) {
    return `<section class="empty">
      <h2>Сложных слов пока нет</h2>
      <p>Они появятся, если в карточках нажать «Не знаю» или ошибиться в тесте. Сейчас смотрим уровень: ${esc(levelOptionLabel(settings.level))}.</p>
    </section>`
  }
  const rows = shown.map((word) => {
    const card = state.progress.cards[word.id]
    return `<div class="word-row">
      <div><span class="row-hanzi" lang="zh-Hans">${esc(word.hanzi)}</span><span class="row-py">${esc(word.pinyin)}</span></div>
      <div>
        <div class="row-mean">${esc(word.meaning)}</div>
        <div class="row-meta">${esc(levelName(word.level))} · ошибок: ${card?.lapses || 0} · ответов: ${card?.reviews || 0}</div>
      </div>
      <button type="button" class="ghost" data-action="practice-word" data-word-id="${esc(word.id)}">Повторить</button>
    </div>`
  }).join('')
  return `<section>
    <h2>Сложные слова</h2>
    <p class="hint" style="text-align:left">Уровень: ${esc(levelOptionLabel(settings.level))}. Всего сложных: ${all.length}. Это слова с ошибками или низкой «лёгкостью» в повторениях.</p>
    <input id="hard-search" class="search" type="search" placeholder="Поиск: иероглиф, пиньинь или значение" value="${esc(state.hardQuery)}" />
    <div class="actions" style="margin-bottom:12px">
      <button type="button" class="primary" data-action="practice-hard">Учить эти слова</button>
    </div>
    <div class="word-list">${rows}</div>
    ${filtered.length > shown.length ? `<p class="hint">Показаны первые ${shown.length}. Уточните поиск.</p>` : ''}
  </section>`
}

function statsScreen() {
  const cards = state.progress.cards
  const settings = state.progress.settings
  const scoped = filterWords(state.words, cards, { level: settings.level, difficulty: 'all' })
  const stats = summarize(scoped, cards)
  const rows = summarizeLevels(state.words, cards).map((row) => `
    <tr>
      <td>${esc(levelName(row.level))}</td>
      <td>${row.total}</td>
      <td>${row.new}</td>
      <td>${row.reviewing}</td>
      <td>${row.learned}</td>
      <td>${row.hard}</td>
    </tr>`).join('')
  const attempts = stats.correct + stats.incorrect
  const accuracy = attempts ? `${Math.round((stats.correct / attempts) * 100)}% верных (${stats.correct} из ${attempts})` : 'пока нет ответов'
  const meta = state.meta || {}
  return `<section class="quiz-card">
      <h2>Прогресс · ${esc(levelOptionLabel(settings.level))}</h2>
      <p class="score">${formatCount(stats.learned)}</p>
      <p class="hint">выучено из ${formatCount(stats.total)}. ${esc(accuracy)}. К повторению сейчас: ${formatCount(stats.due)}.</p>
      <p>Новое — ещё не открывали. Повторяется — уже учили, срок ещё короткий. Выучено — ответы уверенные и следующее повторение не раньше чем через 21 день. Сложное — в последний раз было «Не знаю», либо слово всё ещё даётся тяжело.</p>
      <div class="row" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px">
        <label class="field">Новых за серию
          ${selectBox('new-limit', settings.newLimit, [['5', '5'], ['10', '10'], ['15', '15'], ['20', '20']])}
        </label>
        <label class="field">Слов в серии
          ${selectBox('session-size', settings.sessionSize, [['10', '10'], ['20', '20'], ['30', '30']])}
        </label>
      </div>
      <div class="end-actions" style="justify-content:flex-start">
        <button type="button" class="ghost" data-action="export-progress">Сохранить прогресс в файл</button>
        <button type="button" class="ghost" data-action="import-progress">Загрузить прогресс</button>
        <button type="button" class="ghost" data-action="reset-progress">Сбросить ответы</button>
        <input id="import-file" type="file" accept="application/json,.json" hidden />
      </div>
    </section>
    <div class="table-wrap" style="margin-top:16px">
      <table>
        <thead><tr><th>Уровень</th><th>Всего</th><th>Новые</th><th>Повторяются</th><th>Выучены</th><th>Сложные</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="hint" style="text-align:left">Уровни 7–9 в экзамене — одна полоса. Здесь она разрезана на три учебные части, так устроен открытый список.</p>
    </div>
    <section class="about">
      <h2>Откуда слова</h2>
      <p>В программе ${formatCount(state.words.length)} слов официального перечня HSK 3.0 (考试大纲, ноябрь 2025). Список опубликован Gushi, лицензия CC BY-SA 4.0. Значения на английском — из словаря CC-CEDICT, примеры в основном из Tatoeba. Слова не придумывались.</p>
      <p><a href="https://gushichinese.com/hsk-3.0/downloads">Gushi — список HSK 3.0</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a> · <a href="https://www.mdbg.net/chinese/dictionary?page=cc-cedict">CC-CEDICT</a> · <a href="https://tatoeba.org">Tatoeba</a></p>
      <p>${esc(meta.attribution || '')}</p>
    </section>`
}

function render() {
  const active = document.activeElement
  const activeId = active?.id || ''
  let caret = null
  try { caret = active?.selectionStart } catch { caret = null }
  app.innerHTML = shell()
  app.dataset.ready = '1'
  if (activeId) {
    const el = document.getElementById(activeId)
    if (el) {
      el.focus()
      if (typeof caret === 'number' && el.setSelectionRange) {
        const next = Math.min(caret, el.value.length)
        el.setSelectionRange(next, next)
      }
      return
    }
  }
  document.querySelector('#quiz-input')?.focus()
}

function safeRender() {
  try {
    render()
  } catch (error) {
    console.error(error)
    app.dataset.ready = 'error'
    app.innerHTML = `<p class="error">Что-то сломалось в программе: ${esc(error.message)}</p>`
  }
}

function onClick(event) {
  const link = event.target.closest('a[href]')
  if (link && window.hsk?.openExternal) {
    event.preventDefault()
    window.hsk.openExternal(link.href)
    return
  }
  const button = event.target.closest('[data-action], [data-nav]')
  if (!button || button.disabled) return
  if (button.dataset.nav) {
    state.screen = button.dataset.nav
    state.banner = ''
    safeRender()
    return
  }
  const action = button.dataset.action
  if (action === 'reveal') {
    state.revealed = true
    safeRender()
  } else if (action === 'grade') {
    gradeCurrent(Number(button.dataset.grade))
  } else if (action === 'dismiss-intro') {
    state.progress.settings.introSeen = true
    persist()
    safeRender()
  } else if (action === 'text-smaller' || action === 'text-larger') {
    const sizes = ['s', 'm', 'l']
    const index = sizes.indexOf(state.progress.settings.textSize)
    const next = sizes[Math.min(sizes.length - 1, Math.max(0, index + (action === 'text-larger' ? 1 : -1)))]
    updateSetting('textSize', next)
  } else if (action === 'speak') {
    const word = spokenWord()
    if (word) speak(button.dataset.what === 'example' ? word.exampleZh : word.hanzi)
  } else if (action === 'start-quiz') {
    startQuiz()
  } else if (action === 'clear-quiz') {
    state.quiz = null
    safeRender()
  } else if (action === 'choose' && state.quiz?.phase === 'answer') {
    commitQuizAnswer(button.dataset.wordId)
  } else if (action === 'quiz-skip') {
    commitQuizAnswer('__skip__')
  } else if (action === 'quiz-next') {
    nextQuestion()
  } else if (action === 'study-missed') {
    const words = state.quiz.results.filter((item) => !item.ok).map((item) => state.byId.get(item.wordId))
    studyWords(words.filter(Boolean))
  } else if (action === 'next-series') {
    state.queueBuilt = false
    safeRender()
  } else if (action === 'practice-hard') {
    state.progress.settings.difficulty = 'hard'
    state.queueBuilt = false
    state.screen = 'cards'
    persist()
    safeRender()
  } else if (action === 'practice-word') {
    const word = state.byId.get(button.dataset.wordId)
    if (word) studyWords([word])
  } else if (action === 'export-progress') {
    exportProgress()
  } else if (action === 'import-progress') {
    if (window.hsk?.importProgress) importFromElectron()
    else document.querySelector('#import-file')?.click()
  } else if (action === 'reset-progress') {
    if (!confirm('Точно стереть весь прогресс на этом компьютере? Слова останутся, сотрутся только ваши ответы.')) return
    const settings = state.progress.settings
    state.progress = defaultProgress()
    state.progress.settings = settings
    state.queueBuilt = false
    state.quiz = null
    persist()
    state.banner = 'Ответы стёрты.'
    safeRender()
  }
}

function spokenWord() {
  if (state.screen === 'quiz' && state.quiz?.questions?.length) {
    const index = Math.min(state.quiz.index, state.quiz.questions.length - 1)
    return state.byId.get(state.quiz.questions[index].wordId)
  }
  return state.queue?.[state.queueIndex] || null
}

function onChange(event) {
  const id = event.target.id
  const value = event.target.value
  if (id === 'level-select') updateSetting('level', value)
  else if (id === 'difficulty-select') updateSetting('difficulty', value)
  else if (id === 'quiz-count') updateSetting('quizCount', Number(value))
  else if (id === 'quiz-type') updateSetting('quizType', value)
  else if (id === 'new-limit') updateSetting('newLimit', Number(value))
  else if (id === 'session-size') updateSetting('sessionSize', Number(value))
  else if (id === 'hard-search') {
    state.hardQuery = value
    safeRender()
  } else if (id === 'import-file') {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try { applyImport(JSON.parse(String(reader.result))) }
      catch { state.banner = 'Не получилось прочитать файл.'; safeRender() }
    }
    reader.readAsText(file)
  }
}

function onSubmit(event) {
  const form = event.target.closest?.('form') || event.target
  if (!form || form.dataset?.action !== 'check-type') return
  event.preventDefault()
  const value = document.querySelector('#quiz-input')?.value || ''
  if (!value.trim()) {
    state.quiz.hint = 'Сначала впишите ответ'
    safeRender()
    return
  }
  state.quiz.hint = ''
  commitQuizAnswer(value)
}

function onKey(event) {
  const tag = event.target?.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
  if (state.screen !== 'cards' || !state.queueBuilt) return
  if (!state.queue[state.queueIndex]) return
  if (event.key === ' ' || event.code === 'Space') {
    event.preventDefault()
    if (!state.revealed) {
      state.revealed = true
      safeRender()
    }
    return
  }
  if (event.key === '1') gradeCurrent(GRADE.again)
  else if (state.revealed && event.key === '2') gradeCurrent(GRADE.hard)
  else if (state.revealed && event.key === '3') gradeCurrent(GRADE.good)
  else if (state.revealed && event.key === '4') gradeCurrent(GRADE.easy)
}

async function exportProgress() {
  try {
    if (window.hsk?.exportProgress) {
      const ok = await window.hsk.exportProgress(state.progress)
      state.banner = ok ? 'Прогресс сохранён в файл.' : ''
      if (ok) safeRender()
      return
    }
    const blob = new Blob([JSON.stringify(state.progress, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'hsk-progress.json'
    link.click()
    URL.revokeObjectURL(url)
    state.banner = 'Файл прогресса скачан.'
    safeRender()
  } catch (error) {
    state.banner = error.message || 'Не получилось сохранить файл.'
    safeRender()
  }
}

async function importFromElectron() {
  try {
    const raw = await window.hsk.importProgress()
    if (raw) applyImport(raw)
  } catch (error) {
    state.banner = error.message || 'Не получилось открыть файл.'
    safeRender()
  }
}

function applyImport(raw) {
  if (!isProgressFile(raw)) {
    state.banner = 'Этот файл не похож на сохранение HSK Слова.'
    safeRender()
    return
  }
  if (!confirm('Заменить текущий прогресс данными из файла?')) return
  state.progress = normalizeProgress(raw)
  document.body.dataset.size = state.progress.settings.textSize
  state.queueBuilt = false
  state.quiz = null
  persist()
  state.banner = 'Прогресс загружен.'
  safeRender()
}

function bind() {
  app.addEventListener('click', onClick)
  app.addEventListener('change', onChange)
  app.addEventListener('input', onChange)
  app.addEventListener('submit', onSubmit)
  document.addEventListener('keydown', onKey)
}

async function init() {
  try {
    const [dataset, saved] = await Promise.all([loadDataset(), loadProgress()])
    state.meta = dataset.meta || null
    state.words = dataset.words || []
    state.byId = new Map(state.words.map((word) => [word.id, word]))
    state.progress = normalizeProgress(saved)
    document.body.dataset.size = state.progress.settings.textSize
    bind()
    safeRender()
  } catch (error) {
    console.error(error)
    app.dataset.ready = 'error'
    app.innerHTML = `<p class="error">Не получилось открыть словарь. ${esc(error.message)}</p>`
  }
}

init()
