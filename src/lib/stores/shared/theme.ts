import {writable} from 'svelte/store';
import {CookieParser} from '../../cookie-parser';

export function createWritableStore<T>(key: string, startValue: T) {
  const {subscribe, set} = writable<T>(startValue);
  return {
    subscribe,
    set,
    useLocalStorage: () => {
      const json = localStorage.getItem(key);
      if (json) {
        set(JSON.parse(json));
      }

      subscribe((current) => {
        localStorage.setItem(key, JSON.stringify(current));
      });
    },
  };
}

function getTheme() {
  try {
    const cp = new CookieParser(document?.cookie ?? "");
    return cp.get()['theme'] ?? 'light';
  } catch {
    return 'light';
  }
}

export const theme = createWritableStore('theme', { mode: getTheme() });