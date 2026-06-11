let words: Set<string> | null = null;
let loading: Promise<Set<string>> | null = null;

/** Loads the ENABLE word list once, for instant client-side feedback while dragging. */
export function loadDictionary(): Promise<Set<string>> {
  if (words) return Promise.resolve(words);
  if (!loading) {
    loading = fetch('/dict/enable1.txt')
      .then((r) => r.text())
      .then((raw) => {
        words = new Set(raw.split(/\r?\n/).filter(Boolean).map((w) => w.toUpperCase()));
        return words;
      });
  }
  return loading;
}

export function getWords(): Set<string> | null {
  return words;
}
