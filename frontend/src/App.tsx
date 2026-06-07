import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import CaseDetailView from "./views/CaseDetailView";

const DashboardView = lazy(() => import("./views/DashboardView"));
const CasesListView = lazy(() => import("./views/CasesListView"));
const SearchView = lazy(() => import("./views/SearchView"));
const SettingsView = lazy(() => import("./views/SettingsView"));

const TAB_FALLBACK = (
  <div style={{ padding: 24, color: "#9ca3af", fontSize: 14 }}>Loading…</div>
);

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <Suspense fallback={TAB_FALLBACK}>
              <DashboardView />
            </Suspense>
          }
        />
        <Route
          path="/cases"
          element={
            <Suspense fallback={TAB_FALLBACK}>
              <CasesListView />
            </Suspense>
          }
        />
        <Route path="/cases/:id" element={<CaseDetailView />} />
        <Route
          path="/search"
          element={
            <Suspense fallback={TAB_FALLBACK}>
              <SearchView />
            </Suspense>
          }
        />
        <Route
          path="/settings"
          element={
            <Suspense fallback={TAB_FALLBACK}>
              <SettingsView />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
