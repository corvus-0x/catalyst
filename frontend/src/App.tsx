import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import CaseDetailView from "./views/CaseDetailView";

function Dashboard() {
  return <div style={{ padding: 24 }}>Dashboard -- coming soon</div>;
}

function CasesList() {
  return <div style={{ padding: 24 }}>CasesList -- coming soon</div>;
}

function SearchView() {
  return <div style={{ padding: 24 }}>SearchView -- coming soon</div>;
}

function Settings() {
  return <div style={{ padding: 24 }}>Settings -- coming soon</div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/cases" element={<CasesList />} />
        <Route path="/cases/:id" element={<CaseDetailView />} />
        <Route path="/search" element={<SearchView />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
