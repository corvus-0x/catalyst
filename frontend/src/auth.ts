const API_TOKEN_STORAGE_KEY = "catalyst_api_token";

export function getApiToken(): string {
    return localStorage.getItem(API_TOKEN_STORAGE_KEY) ?? "";
}

export function setApiToken(token: string): void {
    localStorage.setItem(API_TOKEN_STORAGE_KEY, token.trim());
}

export function clearApiToken(): void {
    localStorage.removeItem(API_TOKEN_STORAGE_KEY);
}

export function hasApiToken(): boolean {
    return getApiToken().length > 0;
}
