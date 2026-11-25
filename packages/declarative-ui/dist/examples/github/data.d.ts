import { GithubDashboardItem, GithubTokenConfig } from "./types.js";
export declare const STORAGE_KEY_GITHUB_TOKEN = "github_personal_access_token";
export declare const SAMPLE_GITHUB_ITEMS: GithubDashboardItem[];
export declare function getGithubToken(): Promise<GithubTokenConfig | null>;
export declare function setGithubToken(token: string, username?: string): Promise<GithubTokenConfig>;
export declare function clearGithubToken(): Promise<void>;
export declare function isGithubTokenConfigured(): Promise<boolean>;
export declare function filterGithubItems(items: GithubDashboardItem[], query: string, category: string, subFilter?: string): GithubDashboardItem[];
