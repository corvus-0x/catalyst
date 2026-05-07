import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

/* ─── Placeholder stub components ───────────────────────────────────────────
   These will be replaced by real page components in later build steps.
   Each renders a bare div so the router is testable immediately.
─────────────────────────────────────────────────────────────────────────── */

function Dashboard() {
  return <div>Dashboard — coming soon</div>;
}

function CasesList() {
  return <div>CasesList — coming soon</div>;
}

function CaseDetail() {
  return <div>CaseDetail — coming soon</div>;
}

function SearchView() {
  return <div>SearchView — coming soon</div>;
}

function Settings() {
  return <div>Settings — coming soon</div>;
}

/* ─── Router ─────────────────────────────────────────────────────────────── */

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/cases" element={<CasesList />} />
        <Route path="/cases/:id" element={<CaseDetail />} />
        <Route path="/search" element={<SearchView />} />
        <Route path="/settings" element={<Settings />} />
        {/* Catch-all: redirect unknown paths to dashboard */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
