import { Navigate, Outlet, useLocation } from "react-router-dom";
import { hasApiToken } from "../../auth";

export function RequireLogin() {
    const location = useLocation();

    if (!hasApiToken()) {
        const redirectTo = `${location.pathname}${location.search}${location.hash}`;
        return <Navigate to="/login" replace state={{ redirectTo }} />;
    }

    return <Outlet />;
}
