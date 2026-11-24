// Saying the list out loud. Each pause ends an item, so "חלב… לחם… שתי עגבניות" becomes three
// lines. In a browser this is the Web Speech API (Chrome sends the sound to Google, Safari to
// Apple); inside the iPhone app it is the phone's own recognizer, through the Dictation plugin in
// ios/App/App/DictationPlugin.swift.

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isNativeApp } from './native';
import { stripDirectionMarks } from './text';

export type DictationError = 'denied' | 'no-mic' | 'network' | 'unsupported' | 'failed';

export interface DictationEvents {
  /** Items heard so far, one per pause, and the words of the item still being said. */
  onText(heard: string[], current: string): void;
  /** Listening stopped: asked to, after a long silence, or because of `error`. */
  onEnd(error?: DictationError): void;
}

export interface Dictation {
  /** Stop listening. What was said until now is kept and reported once more. */
  stop(): void;
}

/** Stop by itself after this long without a word, so a forgotten microphone does not stay on. */
const QUIET_LIMIT_MS = 20_000;

interface NativeDictationPlugin {
  available(): Promise<{ available: boolean }>;
  start(options: { language: string }): Promise<void>;
  stop(): Promise<void>;
  addListener(event: 'text', fn: (e: { heard: string[]; current: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'end', fn: (e: { error?: string }) => void): Promise<PluginListenerHandle>;
}

const NativeDictation = registerPlugin<NativeDictationPlugin>('Dictation');

// The Web Speech API is not in TypeScript's DOM types everywhere; this is the part used here.
interface WebRecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface WebRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<WebRecognitionResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  /** The microphone is on (after any permission prompt). */
  onaudiostart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type WebRecognitionClass = new () => WebRecognition;

const webRecognition = (): WebRecognitionClass | undefined =>
  typeof window === 'undefined'
    ? undefined
    : ((window as unknown as { SpeechRecognition?: WebRecognitionClass }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: WebRecognitionClass }).webkitSpeechRecognition);

/** Whether this phone or browser can turn speech into text at all. */
export const canDictate = () => isNativeApp || webRecognition() !== undefined;

export function startDictation(events: DictationEvents): Dictation {
  return isNativeApp ? startNative(events) : startWeb(events);
}

function webError(code: string): DictationError {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'denied';
  if (code === 'audio-capture') return 'no-mic';
  if (code === 'network') return 'network';
  if (code === 'language-not-supported') return 'unsupported';
  return 'failed';
}

function startWeb(events: DictationEvents): Dictation {
  const Recognition = webRecognition();
  if (!Recognition) {
    queueMicrotask(() => events.onEnd('unsupported'));
    return { stop() {} };
  }
  // Chrome on Android repeats earlier words when it listens continuously, so there each item is
  // its own short session, started again as soon as the previous one ends.
  const oneItemPerSession = /Android/i.test(navigator.userAgent);
  const heard: string[] = [];
  let current = '';
  let recognition: WebRecognition | null = null;
  let stopping = false;
  let ended = false;
  let fatal: DictationError | undefined;
  let quietTimer = 0;

  const end = (error?: DictationError) => {
    if (ended) return;
    ended = true;
    window.clearTimeout(quietTimer);
    if (current.trim()) heard.push(current.trim());
    current = '';
    events.onText([...heard], '');
    events.onEnd(error);
  };
  const stop = () => {
    if (stopping || ended) return;
    stopping = true;
    try {
      recognition?.stop();
    } catch {
      /* already stopped */
    }
    // `onend` normally follows within a moment; do not wait forever if it never comes.
    window.setTimeout(() => end(), 1500);
  };
  const keepAwake = () => {
    window.clearTimeout(quietTimer);
    quietTimer = window.setTimeout(stop, QUIET_LIMIT_MS);
  };

  const session = () => {
    const rec = new Recognition();
    recognition = rec;
    rec.lang = 'he-IL';
    rec.continuous = !oneItemPerSession;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onaudiostart = keepAwake;
    const done = new Set<number>();
    rec.onresult = (e) => {
      current = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const words = stripDirectionMarks(result[0].transcript).trim();
        if (!words) continue;
        if (result.isFinal) {
          if (!done.has(i) && heard[heard.length - 1] !== words) heard.push(words);
          done.add(i);
        } else current += (current ? ' ' : '') + words;
      }
      keepAwake();
      events.onText([...heard], current);
    };
    rec.onerror = (e) => {
      // Silence and our own stop are not problems; anything else ends the dictation.
      if (e.error !== 'no-speech' && e.error !== 'aborted') fatal = webError(e.error);
    };
    rec.onend = () => {
      if (stopping || fatal) return end(fatal);
      // The browser stops after each pause or after a while; keep listening until told to stop.
      if (current.trim()) heard.push(current.trim());
      current = '';
      events.onText([...heard], '');
      window.setTimeout(() => {
        if (!stopping && !ended) session();
      }, 120);
    };
    try {
      rec.start();
    } catch {
      end('failed');
    }
  };

  session();
  return { stop };
}

function startNative(events: DictationEvents): Dictation {
  const handles: Array<Promise<PluginListenerHandle>> = [];
  let ended = false;
  let quietTimer = 0;
  const end = (error?: DictationError) => {
    if (ended) return;
    ended = true;
    window.clearTimeout(quietTimer);
    for (const h of handles) void h.then((x) => x.remove());
    events.onEnd(error);
  };
  const stop = () => {
    void NativeDictation.stop().catch(() => {});
    // The plugin reports the last words and then "end"; make sure the screen is not left waiting.
    window.setTimeout(() => end(), 1500);
  };
  const keepAwake = () => {
    window.clearTimeout(quietTimer);
    quietTimer = window.setTimeout(stop, QUIET_LIMIT_MS);
  };

  handles.push(
    NativeDictation.addListener('text', (e) => {
      keepAwake();
      events.onText((e.heard ?? []).map(stripDirectionMarks), stripDirectionMarks(e.current ?? ''));
    }),
  );
  handles.push(
    NativeDictation.addListener('end', (e) =>
      end(e.error ? (['denied', 'no-mic', 'network', 'unsupported'].includes(e.error) ? (e.error as DictationError) : 'failed') : undefined),
    ),
  );
  // The silence clock starts once listening has begun, not while permission prompts are open.
  NativeDictation.start({ language: 'he-IL' }).then(keepAwake, (err: { code?: string; message?: string }) => {
    console.warn('Dictation did not start', err?.code, err?.message);
    const code = err?.code ?? err?.message ?? '';
    end(code === 'denied' ? 'denied' : code === 'unsupported' ? 'unsupported' : 'failed');
  });
  return { stop };
}

/** What to tell the shopper when listening did not work. */
export function dictationProblem(error: DictationError): string {
  switch (error) {
    case 'denied':
      return 'אין גישה למיקרופון. אפשר לאשר אותה בהגדרות הטלפון או הדפדפן, או להקליד את הרשימה.';
    case 'no-mic':
      return 'לא נמצא מיקרופון שעובד.';
    case 'network':
      return 'זיהוי הדיבור צריך חיבור לאינטרנט. אפשר להקליד את הרשימה בינתיים.';
    case 'unsupported':
      return 'הטלפון או הדפדפן הזה לא מזהים דיבור בעברית. אפשר להקליד או להדביק את הרשימה.';
    default:
      return 'זיהוי הדיבור לא הצליח. נסה שוב.';
  }
}
