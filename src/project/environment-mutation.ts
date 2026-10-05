interface EnvironmentMutationSuccess {
  environmentId: string;
  success: true;
}

interface EnvironmentMutationFailure {
  error?: string;
  success: false;
}

export interface EnvironmentMutation {
  execute: () => Promise<
    EnvironmentMutationSuccess | EnvironmentMutationFailure
  >;
  fallbackError: string;
  isCurrent: () => boolean;
  onFailure: (message: string) => void;
  onSettled: () => void;
  onSuccess: (environmentId: string) => Promise<void>;
}

/** A retired manager must never refresh or update its replacement's state. */
export const performEnvironmentMutation = async ({
  execute,
  fallbackError,
  isCurrent,
  onFailure,
  onSettled,
  onSuccess,
}: EnvironmentMutation): Promise<void> => {
  try {
    const result = await execute();
    if (!isCurrent()) {
      return;
    }
    if (!result.success) {
      onFailure(result.error || fallbackError);
      return;
    }
    await onSuccess(result.environmentId);
  } catch (error) {
    if (isCurrent()) {
      onFailure(error instanceof Error ? error.message : fallbackError);
    }
  } finally {
    if (isCurrent()) {
      onSettled();
    }
  }
};
