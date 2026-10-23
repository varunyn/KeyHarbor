import React from "react";

import { mountRenderer } from "../renderer/mount";
import { RendererProviders } from "../renderer/providers";
import { cn } from "../renderer/ui/utils";
import { nativeWindowStyles } from "../renderer/window-chrome";
import { DashboardDialog } from "./dashboard-dialog";
import { t } from "./dashboard-display";
import { DashboardHeader } from "./dashboard-header";
import { DashboardSidebar } from "./dashboard-sidebar";
import { HomeFolderImport } from "./folder-import";
import { ProjectCollection } from "./project-collection";
import { ProjectFilters } from "./project-filters";
import { StatisticsStrip } from "./statistics-strip";
import { useDashboard } from "./use-dashboard";

const App = () => {
  const dashboard = useDashboard();
  const {
    appRef,
    sidebarOpen,
    menu,
    setMenu,
    loadVaults,
    activeVault,
    vaults,
    switchVault,
    openDialog,
    removeVault,
    projects,
    navigate,
    syncAt,
    now,
    dialogStateRef,
    closeSidebar,
    showStatistics,
    statistics,
    loadState,
    activeVaultId,
    dialog,
    dialogRef,
    form,
    actionBusy,
    closeDialog,
    setField,
    browseFolder,
    submitProject,
    submitVaultCreate,
    submitVaultImport,
    submitVaultRename,
    confirmationDialog,
  } = dashboard;
  const openCreateVault = (trigger?: HTMLElement | null) =>
    openDialog("create-vault", trigger);
  const openImportVault = (trigger?: HTMLElement | null) =>
    openDialog("import-vault", trigger);

  return (
    <div
      className={cn(
        "dash-app bg-background text-foreground flex h-dvh overflow-hidden font-sans",
        nativeWindowStyles.canvas
      )}
      ref={appRef}
    >
      <DashboardSidebar
        sidebarOpen={sidebarOpen}
        menu={menu}
        setMenu={setMenu}
        loadVaults={loadVaults}
        activeVault={activeVault}
        vaults={vaults}
        switchVault={switchVault}
        openDialog={openDialog}
        removeVault={removeVault}
        openCreateVault={openCreateVault}
        openImportVault={openImportVault}
        projectsCount={projects.length}
        navigate={navigate}
        syncAt={syncAt}
        now={now}
        dialogStateRef={dialogStateRef}
      />
      <button
        type="button"
        className={cn(
          "dash-sidebar-scrim fixed inset-0 z-40 bg-black/50 backdrop-blur-xs transition-opacity min-[861px]:hidden",
          sidebarOpen ? "block opacity-100" : "hidden opacity-0"
        )}
        hidden={!sidebarOpen}
        aria-label={t("project.sidebar.collapse")}
        onClick={closeSidebar}
      />
      <main className="dash-main bg-background flex min-w-0 flex-1 flex-col overflow-hidden">
        <DashboardHeader
          sidebarOpen={dashboard.sidebarOpen}
          toggleSidebar={dashboard.toggleSidebar}
          searchRef={dashboard.searchRef}
          search={dashboard.search}
          setSearch={dashboard.setSearch}
          actionBusy={dashboard.actionBusy}
          lock={dashboard.lock}
          menu={dashboard.menu}
          setMenu={dashboard.setMenu}
          cliReady={dashboard.cliReady}
          cliInstalled={dashboard.cliInstalled}
          onCli={dashboard.handleCli}
          navigate={dashboard.navigate}
          openDialog={dashboard.openDialog}
        />
        <div className="dash-canvas flex-1 space-y-6 overflow-y-auto p-6 lg:p-8">
          <div className="dash-heading space-y-1">
            <h1 className="text-foreground text-2xl font-semibold tracking-tight">
              {t("dashboard.title")}
            </h1>
            <p className="dash-subtitle text-muted-foreground text-xs">
              {t("dashboard.subtitle")}
            </p>
          </div>
          {showStatistics && statistics && (
            <StatisticsStrip statistics={statistics} />
          )}
          <section
            className="dash-section space-y-4"
            aria-label={t("dashboard.a11y.sectionLabel")}
          >
            <ProjectFilters
              projectFilter={dashboard.projectFilter}
              setProjectFilter={dashboard.setProjectFilter}
              projects={dashboard.projects}
              favorites={dashboard.favorites}
              viewMode={dashboard.viewMode}
              setViewMode={dashboard.setViewMode}
              menu={dashboard.menu}
              setMenu={dashboard.setMenu}
              sortMode={dashboard.sortMode}
              setSortMode={dashboard.setSortMode}
            />
            <div id="projects-container">
              <ProjectCollection
                loadState={dashboard.loadState}
                refresh={dashboard.refresh}
                visibleProjects={dashboard.visibleProjects}
                projects={dashboard.projects}
                setSearch={dashboard.setSearch}
                setProjectFilter={dashboard.setProjectFilter}
                searchRef={dashboard.searchRef}
                openDialog={dashboard.openDialog}
                viewMode={dashboard.viewMode}
                accessTimes={dashboard.accessTimes}
                now={dashboard.now}
                favorites={dashboard.favorites}
                menu={dashboard.menu}
                toggleFavorite={dashboard.toggleFavorite}
                setMenu={dashboard.setMenu}
                closeMenus={dashboard.closeMenus}
                deleteProject={dashboard.deleteProject}
              />
            </div>
          </section>
          {loadState === "ready" && (
            <HomeFolderImport
              key={activeVaultId}
              projects={projects}
              onCreateProject={(trigger) => openDialog("project", trigger)}
            />
          )}
        </div>
        <footer className="dash-footer bg-card/90 border-border text-muted-foreground fixed right-4 bottom-3 z-20 flex items-center gap-3 rounded-lg border px-3 py-1.5 text-xs shadow-sm backdrop-blur-xs">
          <span>
            <kbd className="bg-secondary/80 border-border rounded border px-1 py-0.5 font-mono text-[10px]">
              Enter
            </kbd>{" "}
            {t("dashboard.card.open")}
          </span>
          <span>
            <kbd className="bg-secondary/80 border-border rounded border px-1 py-0.5 font-mono text-[10px]">
              ⌘K / Ctrl+K
            </kbd>{" "}
            {t("dashboard.a11y.searchLabel")}
          </span>
          <span className="dash-footer-local hidden items-center gap-1.5 min-[1001px]:inline-flex">
            <span
              className="dash-sync-dot bg-success size-1.5 rounded-full"
              aria-hidden="true"
            />
            {t("dashboard.card.storedLocally")}
          </span>
        </footer>
      </main>
      <DashboardDialog
        dialog={dialog}
        dialogRef={dialogRef}
        form={form}
        actionBusy={actionBusy}
        onClose={closeDialog}
        onFieldChange={setField}
        onBrowseFolder={browseFolder}
        onSubmitProject={submitProject}
        onSubmitVaultCreate={submitVaultCreate}
        onSubmitVaultImport={submitVaultImport}
        onSubmitVaultRename={submitVaultRename}
      />
      {confirmationDialog}
    </div>
  );
};

const rootNode = document.querySelector<HTMLElement>("#dashboard-root");
if (!rootNode) {
  throw new Error("Missing Dashboard root element");
}
mountRenderer(
  rootNode,
  <RendererProviders>
    <App />
  </RendererProviders>
);
