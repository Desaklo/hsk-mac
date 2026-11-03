const TONE_MARKS = {
  ā: 'a', á: 'a', ǎ: 'a', à: 'a',
  ē: 'e', é: 'e', ě: 'e', è: 'e',
  ī: 'i', í: 'i', ǐ: 'i', ì: 'i',
  ō: 'o', ó: 'o', ǒ: 'o', ò: 'o',
  ū: 'u', ú: 'u', ǔ: 'u', ù: 'u',
  ü: 'u', ǖ: 'u', ǘ: 'u', ǚ: 'u', ǜ: 'u',
  ń: 'n', ň: 'n', ǹ: 'n',
  ḿ: 'm',
}

/** Letters only, tones removed, so "ài", "ai4" and "ai" compare equal. */
export function normalizePinyin(value) {
  let out = ''
  const text = String(value ?? '').normalize('NFC').toLowerCase().replace(/u:/g, 'ü')
  for (const char of text) {
    if (TONE_MARKS[char]) out += TONE_MARKS[char]
    else if (char === 'v') out += 'u'
    else if (char >= 'a' && char <= 'z') out += char
  }
  return out
}

export function pinyinMatches(input, expected) {
  const got = normalizePinyin(input)
  if (!got) return false
  const options = String(expected ?? '')
    .split(/[,，/]/)
    .map((part) => normalizePinyin(part))
    .filter(Boolean)
  return options.some((part) => part === got)
}

export function hanziMatches(input, expected) {
  const got = String(input ?? '').replace(/\s+/g, '')
  const want = String(expected ?? '').replace(/\s+/g, '')
  return got.length > 0 && got === want
}
