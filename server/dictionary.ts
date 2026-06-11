import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let words: Set<string> | null = null;

export function getDictionary(): Set<string> {
  if (!words) {
    const file = path.join(__dirname, '..', 'public', 'dict', 'enable1.txt');
    const raw = readFileSync(file, 'utf8');
    words = new Set(raw.split(/\r?\n/).filter(Boolean).map((w) => w.toUpperCase()));
    console.log(`Dictionary loaded: ${words.size} words`);
  }
  return words;
}
