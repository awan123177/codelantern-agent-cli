import { TimeoutError, FirstTokenTimeoutError, CancelledError } from './errors.js';

export function createLinkedAbortController(parentSignal?: AbortSignal, timeoutMs?: number): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | null = null;

  if (timeoutMs && timeoutMs > 0) {
    timer = setTimeout(() => {
      controller.abort(new TimeoutError(timeoutMs));
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
  let timedOut = false;

  const timerPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (!firstTokenReceived) {
        timedOut = true;
        reject(new FirstTokenTimeoutError(firstTokenTimeoutMs, provider, model));
      }
    }, firstTokenTimeoutMs);
  });

  const abortPromise = new Promise<never>((_, reject) => {
    if (signal) {
      if (signal.aborted) {
        reject(signal.reason || new CancelledError());
      } else {
        signal.addEventListener('abort', () => reject(signal.reason || new CancelledError()), { once: true });
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
    if (typeof iterator.return === 'function') {
      try {
        await iterator.return();
      } catch {
        // ignore return error
      }
    }
  }
}
