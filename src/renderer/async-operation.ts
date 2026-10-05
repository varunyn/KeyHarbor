/** Run an asynchronous UI operation with cleanup on success, failure, or early return. */
export const runWithCleanup = async <T>(
  operation: () => Promise<T>,
  cleanup: () => void
): Promise<T> => {
  try {
    return await operation();
  } finally {
    cleanup();
  }
};

/** Convert an unsuccessful bridge response into the operation's error path. */
export const requireSuccessfulResponse: <
  T extends { success: boolean; error?: string },
>(
  response: T,
  fallback: string
) => asserts response is T & { success: true } = (response, fallback) => {
  if (!response.success) {
    throw new Error(response.error || fallback);
  }
};
