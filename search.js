// Нормализация и нечёткий поиск. Подключается в background.js (importScripts).

// ё и е в русском — фактически одна буква для поиска.
function normalizeText(s) {
  return (s || '').toLowerCase().replace(/ё/g, 'е');
}

function tokenize(s) {
  return s.split(/[^a-zа-я0-9]+/i).filter(Boolean);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    const cur = [i];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[bl];
}

// Допуск на ошибку растёт со словом: короткие слова почти не прощают опечаток,
// иначе случайное слово той же длины начнёт совпадать с чем угодно.
function fuzzyThreshold(len) {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  return 2;
}

// true, если для каждого слова запроса в тексте нашлось похожее слово
// (расстояние Левенштейна в пределах допуска) — пропущенная/лишняя/неверная буква не страшна.
function fuzzyWordsMatch(normalizedText, queryWords) {
  const textWords = tokenize(normalizedText);
  if (!textWords.length) return false;
  return queryWords.every((qw) => {
    const thresh = fuzzyThreshold(qw.length);
    return textWords.some((tw) => {
      if (Math.abs(tw.length - qw.length) > thresh + 1) return false;
      return levenshtein(tw, qw) <= thresh;
    });
  });
}

// true, если текст подходит под запрос — точное вхождение (после ё→е) или нечёткое по словам.
function textMatchesQuery(text, normalizedQuery, queryWords) {
  const normalizedText = normalizeText(text);
  if (normalizedText.includes(normalizedQuery)) return true;
  return fuzzyWordsMatch(normalizedText, queryWords);
}
