/**
 * Toaster — token-aware sonner mount + re-export of `toast()` for callers.
 *
 * Per spec §15.5: toasts stack in the bottom-right, dismiss on click or after
 * 6 seconds. Theme follows the app theme via `useTheme()`.
 *
 * Mount once near the app root:
 *   <Toaster />
 *
 * Then anywhere:
 *   import { toast } from "../components/ui/Toaster";
 *   toast.success("Flag confirmed");
 *   toast.error("Enqueue failed: 409");
 */
import { Toaster as SonnerToaster } from "sonner";
import { useTheme } from "../../hooks/useTheme";

export { toast } from "sonner";

export function Toaster() {
    const { theme } = useTheme();
    const sonnerTheme = theme === "auto" ? "system" : theme;
    return (
        <SonnerToaster
            theme={sonnerTheme}
            position="bottom-right"
            duration={6000}
            closeButton
            richColors
            visibleToasts={5}
            toastOptions={{
                style: {
                    background: "var(--surface-strong)",
                    color: "var(--text-main)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-md)",
                    fontFamily: "var(--font-sans)",
                    fontSize: "var(--text-sm)",
                    boxShadow: "var(--shadow-card)",
                },
            }}
        />
    );
}
