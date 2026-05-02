import { FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { clearApiToken, hasApiToken, setApiToken } from "../auth";
import { fetchCases } from "../api";
import styles from "./LoginView.module.css";

type LoginLocationState = {
    redirectTo?: string;
};

export function LoginView() {
    const navigate = useNavigate();
    const location = useLocation();
    const [token, setToken] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const state = (location.state as LoginLocationState | null) ?? null;
    const redirectTo = state?.redirectTo || "/";

    useEffect(() => {
        if (hasApiToken()) {
            navigate(redirectTo, { replace: true });
        }
    }, [navigate, redirectTo]);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError(null);

        const candidate = token.trim();
        if (!candidate) {
            setError("Enter your access token.");
            return;
        }

        setSubmitting(true);
        try {
            setApiToken(candidate);
            await fetchCases(1, 0);
            navigate(redirectTo, { replace: true });
        } catch (err) {
            clearApiToken();
            setError((err as Error).message || "Login failed.");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className={styles.loginPage}>
            <section className={styles.loginCard}>
                <p className={styles.eyebrow}>Catalyst Investigator Access</p>
                <h1>Sign In</h1>
                <p className={styles.helpText}>
                    Use your API access token to unlock the workspace and make corrections.
                </p>

                <form onSubmit={handleSubmit} className={styles.loginForm}>
                    <label htmlFor="access-token">Access token</label>
                    <input
                        id="access-token"
                        type="password"
                        autoComplete="off"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder="Paste bearer token"
                        disabled={submitting}
                    />

                    {error && <p className={styles.errorText}>{error}</p>}

                    <button type="submit" disabled={submitting}>
                        {submitting ? "Checking..." : "Sign In"}
                    </button>
                </form>
            </section>
        </div>
    );
}
