import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./layouts/AppShell";
import { CaseWorkspace } from "./layouts/CaseWorkspace";
import { ShellContextProvider } from "./contexts/ShellContext";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { TooltipProvider } from "./components/ui/Tooltip";
import { Toaster } from "./components/ui/Toaster";
import { useTheme } from "./hooks/useTheme";
import { initCSRF } from "./api";
import { RequireLogin } from "./components/auth/RequireLogin";

// Views
import { DashboardView } from "./views/DashboardView";
import { CasesListView } from "./views/CasesListView";
import { EntityBrowserView } from "./views/EntityBrowserView";
import { EntityDetailView } from "./views/EntityDetailView";
import { TriageView } from "./views/TriageView";
import { ReferralsView } from "./views/ReferralsView";
import { SearchView } from "./views/SearchView";
import { SettingsView } from "./views/SettingsView";
import { LoginView } from "./views/LoginView";

export default function App() {
    useTheme();
    useEffect(() => { initCSRF(); }, []);

    return (
        <ErrorBoundary fallbackTitle="Application Error">
            <TooltipProvider>
                <BrowserRouter>
                    <ShellContextProvider>
                        <Toaster />
                        <Routes>
                            <Route path="login" element={<LoginView />} />

                            <Route element={<RequireLogin />}>
                                <Route element={<AppShell />}>
                                    <Route index element={<DashboardView />} />
                                    <Route path="cases" element={<CasesListView />} />

                                    {/* Case workspace — canonical case route */}
                                    <Route path="cases/:caseId" element={<CaseWorkspace />} />

                                    {/* Legacy workspace subroute → redirect to canonical */}
                                    <Route path="cases/:caseId/workspace" element={<Navigate to=".." replace />} />

                                    <Route path="entities" element={<EntityBrowserView />} />
                                    <Route path="entities/:entityType/:entityId" element={<EntityDetailView />} />
                                    <Route path="triage" element={<TriageView />} />
                                    <Route path="referrals" element={<ReferralsView />} />
                                    <Route path="search" element={<SearchView />} />
                                    <Route path="settings" element={<SettingsView />} />

                                    <Route path="*" element={<Navigate to="/" replace />} />
                                </Route>
                            </Route>
                        </Routes>
                    </ShellContextProvider>
                </BrowserRouter>
            </TooltipProvider>
        </ErrorBoundary>
    );
}
