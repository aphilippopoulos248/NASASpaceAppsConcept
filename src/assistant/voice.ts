// Optional voice dictation with the browser's Web Speech API. Where the browser has no
// speech recognition, `createDictation` returns null and the microphone button is not shown.
// Recognition is the browser's own service (it may send audio to the browser vendor);
// Lunyx only receives the recognised text and puts it in the message box for review.

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  isFinal: boolean;
  0: RecognitionAlternative;
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

export interface DictationHandlers {
  /** Text recognised so far in this session: finished phrases plus the phrase in progress. */
  onText(finalText: string, interimText: string): void;
  onState(listening: boolean): void;
  onError(message: string): void;
}

export interface Dictation {
  readonly listening: boolean;
  start(): void;
  stop(): void;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access was not allowed.',
  'service-not-allowed': 'Speech recognition is not allowed in this browser.',
  'no-speech': 'No speech was heard.',
  'audio-capture': 'No microphone was found.',
  network: 'Speech recognition needs a network connection in this browser.',
};

export function speechRecognitionCtor(scope: unknown = globalThis): RecognitionCtor | null {
  const w = scope as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** A dictation controller, or null when this browser has no speech recognition. */
export function createDictation(handlers: DictationHandlers, lang = 'en-US', scope: unknown = globalThis): Dictation | null {
  const Ctor = speechRecognitionCtor(scope);
  if (!Ctor) return null;
  let recognition: Recognition | null = null;
  let listening = false;

  const setListening = (on: boolean) => {
    if (listening === on) return;
    listening = on;
    handlers.onState(on);
  };

  return {
    get listening() {
      return listening;
    },
    start() {
      if (listening) return;
      const r = new Ctor();
      r.lang = lang;
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;
      let finalText = '';
      r.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i];
          if (result.isFinal) finalText += result[0].transcript;
          else interim += result[0].transcript;
        }
        handlers.onText(finalText.trim(), interim.trim());
      };
      r.onerror = (e) => {
        if (e.error !== 'aborted') handlers.onError(ERRORS[e.error] ?? `Speech recognition stopped (${e.error}).`);
      };
      r.onend = () => {
        if (recognition === r) recognition = null;
        setListening(false);
      };
      try {
        r.start();
      } catch {
        handlers.onError('Speech recognition could not start.');
        return;
      }
      recognition = r;
      setListening(true);
    },
    stop() {
      recognition?.stop();
    },
  };
}
