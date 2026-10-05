import type { EnvironmentTarget } from "../project/bridge";

interface EnvironmentSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  secretCount: number;
  isDefault: boolean;
}

interface ManagementVault {
  getEnvironments: (projectName: string) => EnvironmentSummary[];
  createEnvironment: (projectName: string, name: string) => EnvironmentSummary;
  renameEnvironment: (
    projectName: string,
    environmentId: string,
    name: string
  ) => unknown;
  deleteEnvironment: (
    projectName: string,
    environmentId: string,
    options?: { replacementDefaultEnvironmentId?: string }
  ) => {
    deletedEnvironmentId: string;
    affectedSecretCount: number;
    defaultEnvironmentId: string;
  };
}

interface ManagementSession {
  withActiveSession: <T>(
    operation: (session: { activeVault: ManagementVault }) => T | Promise<T>
  ) => Promise<T>;
}

interface IpcMainLike {
  handle: (
    name: string,
    listener: (_event: unknown, ...args: unknown[]) => unknown
  ) => void;
}

const fail = (error: unknown) => ({
  error: error instanceof Error ? error.message : String(error),
  success: false as const,
});

const validTarget = (value: unknown): value is EnvironmentTarget => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const target = value as Record<string, unknown>;
  return (
    Object.keys(target).length === 2 &&
    typeof target.projectName === "string" &&
    target.projectName.length > 0 &&
    typeof target.environmentId === "string" &&
    target.environmentId.length > 0
  );
};

/** Desktop-only Environment management at the admitted VaultSession boundary. */
export const registerEnvironmentManagementIpc = ({
  ipcMain,
  session,
}: {
  ipcMain: IpcMainLike;
  session: ManagementSession;
}): void => {
  ipcMain.handle("projects:environments", async (_event, projectName) => {
    if (typeof projectName !== "string" || !projectName) {
      return { error: "A Project is required", success: false };
    }
    try {
      const data = await session.withActiveSession(({ activeVault }) =>
        activeVault.getEnvironments(projectName)
      );
      return { data, success: true };
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(
    "project:environment:create",
    async (_event, projectName, name) => {
      if (
        typeof projectName !== "string" ||
        !projectName ||
        typeof name !== "string"
      ) {
        return {
          error: "A Project and Environment name are required",
          success: false,
        };
      }
      try {
        const environment = await session.withActiveSession(({ activeVault }) =>
          activeVault.createEnvironment(projectName, name)
        );
        return { environment, success: true };
      } catch (error) {
        return fail(error);
      }
    }
  );

  ipcMain.handle("project:environment:rename", async (_event, target, name) => {
    if (!validTarget(target) || typeof name !== "string") {
      return {
        error: "A Project, Environment, and name are required",
        success: false,
      };
    }
    try {
      const environment = await session.withActiveSession(({ activeVault }) => {
        activeVault.renameEnvironment(
          target.projectName,
          target.environmentId,
          name
        );
        return activeVault
          .getEnvironments(target.projectName)
          .find((entry) => entry.id === target.environmentId);
      });
      if (!environment) {
        throw new Error("Environment target no longer exists");
      }
      return { environment, success: true };
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(
    "project:environment:delete",
    async (_event, target, replacementDefaultEnvironmentId) => {
      if (
        !validTarget(target) ||
        (replacementDefaultEnvironmentId !== undefined &&
          typeof replacementDefaultEnvironmentId !== "string")
      ) {
        return {
          error: "A Project and Environment are required",
          success: false,
        };
      }
      try {
        const data = await session.withActiveSession(({ activeVault }) =>
          activeVault.deleteEnvironment(
            target.projectName,
            target.environmentId,
            replacementDefaultEnvironmentId === undefined
              ? {}
              : { replacementDefaultEnvironmentId }
          )
        );
        return { ...data, success: true };
      } catch (error) {
        return fail(error);
      }
    }
  );
};
