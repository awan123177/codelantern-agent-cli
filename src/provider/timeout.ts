import { TimeoutError, FirstTokenTimeoutError, TotalTimeoutError, CancelledError } from './errors.js';

export function createLinkedAbortController(
  parentSignal?: AbortSignal,
  timeoutMs?: number,
  timeoutErrorFactory?: (timeoutMs: number) => Error
): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | null = null;

  if (timeoutMs && timeoutMs > 0) {
    timer = setTimeout(() => {
      const err = timeoutErrorFactory ? timeoutErrorFactory(timeoutMs) : new TotalTimeoutError(timeoutMs);
      controller.abort(err);
    }, timeoutMs);
  }

  const onParentAbort = () => {
    controller.abort(parentSignal?.reason || new CancelledError());
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      onParentAbort();
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  const cleanup = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  };

  return { controller, cleanup };
}

/**
 * Race a promise against a timeout duration and optional AbortSignal.
 * Cleans up timer and listeners unconditionally in finally.
 */
export async function withTimeoutRace<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string,
  signal?: AbortSignal,
  onTimeout?: () => void,
  errorFactory?: (timeoutMs: number, operation: string) => Error
): Promise<T> {
  if (signal?.aborted) {
    throw signal.reason || new CancelledError();
  }

  let timer: NodeJS.Timeout | null = null;
  let abortListener: (() => void) | null = null;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        if (onTimeout) {
          try {
            onTimeout();
          } catch {}
        }
        reject(errorFactory ? errorFactory(timeoutMs, operationName) : new TimeoutError(timeoutMs, operationName));
      }, timeoutMs);

      if (signal) {
        abortListener = () => {
          if (timer) clearTimeout(timer);
          reject(signal.reason || new CancelledError());
        };
        signal.addEventListener('abort', abortListener, { once: true });
      }
    });

    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener);
    }
  }
}

export async function* wrapStreamWithFirstTokenTimeout<T>(
  stream: AsyncIterable<T>,
  firstTokenTimeoutMs: number,
  provider: string,
  model: string,
  signal?: AbortSignal,
  onFirstToken?: (latencyMs: number) => void
): AsyncGenerator<T, void, unknown> {
  let firstTokenReceived = false;
  const startTime = Date.now();
  let timer: NodeJS.Timeout | null = null;
  let abortListener: (() => void) | null = null;

  let rejectTimer: (err: any) => void;
  const timerPromise = new Promise<never>((_, reject) => {
    rejectTimer = reject;
    timer = setTimeout(() => {
      if (!firstTokenReceived) {
        reject(new FirstTokenTimeoutError(firstTokenTimeoutMs, provider, model));
      }
    }, firstTokenTimeoutMs);
  });

  let rejectAbort: (err: any) => void;
  const abortPromise = new Promise<never>((_, reject) => {
    rejectAbort = reject;
    if (signal) {
      if (signal.aborted) {
        reject(signal.reason || new CancelledError());
      } else {
        abortListener = () => reject(signal.reason || new CancelledError());
        signal.addEventListener('abort', abortListener, { once: true });
      }
    }
  });

  const iterator = stream[Symbol.asyncIterator]();

  try {
    while (true) {
      if (signal?.aborted) {
        throw signal.reason || new CancelledError();
      }

      if (!firstTokenReceived) {
        // Race the first chunk against the first-token timer and signal
        const nextPromise = iterator.next();
        const result = await Promise.race([nextPromise, timerPromise, abortPromise]);

        if (timer) {
          clearTimeout(timer);
          timer = null;
        }

        if (result.done) {
          if (onFirstToken) {
            onFirstToken(Date.now() - startTime);
          }
          break;
        }

        firstTokenReceived = true;
        if (onFirstToken) {
          onFirstToken(Date.now() - startTime);
        }

        yield result.value;
      } else {
        // Subsequent chunks
        if (signal?.aborted) {
          throw signal.reason || new CancelledError();
        }

        const nextPromise = iterator.next();
        const result = signal ? await Promise.race([nextPromise, abortPromise]) : await nextPromise;

        if (result.done) {
          break;
        }

        yield result.value;
      }
    }
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener);
    }
    if (typeof iterator.return === 'function') {
      try {
        await iterator.return();
      } catch {
        // ignore return error
      }
    }
  }
}
