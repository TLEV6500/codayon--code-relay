/**
 * Language support registry for CodeMirror (REQ-019, NFR-004).
 *
 * Provides syntax highlighting for: TypeScript, JavaScript, Bash, PowerShell,
 * HTML, CSS, Python, SQL, JSON, YAML, TOML (as best-effort).
 *
 * Languages are lazy-loaded and extensible without touching the relay or turn
 * engine (NFR-004: extensibility).
 */

import { LanguageSupport } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { xml } from "@codemirror/lang-xml";

export type LanguageName =
  | "typescript"
  | "javascript"
  | "bash"
  | "powershell"
  | "html"
  | "css"
  | "python"
  | "sql"
  | "json"
  | "yaml"
  | "toml";

export interface LanguageInfo {
  readonly name: LanguageName;
  readonly displayName: string;
  readonly extensions: readonly string[];
  readonly getLanguage: () => LanguageSupport;
}

/**
 * Language registry with metadata (REQ-019: full list).
 * Extensible without changes to relay/engine (NFR-004).
 */
export const LANGUAGE_REGISTRY: Record<LanguageName, LanguageInfo> = {
  typescript: {
    name: "typescript",
    displayName: "TypeScript",
    extensions: [".ts", ".tsx"],
    getLanguage: () => javascript({ typescript: true }),
  },
  javascript: {
    name: "javascript",
    displayName: "JavaScript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    getLanguage: () => javascript(),
  },
  bash: {
    name: "bash",
    displayName: "Bash",
    extensions: [".sh", ".bash", ".zsh"],
    // Use XML as a placeholder for shell syntax; CodeMirror has limited shell support.
    // A full shell mode can be added without changing engine/relay (NFR-004).
    getLanguage: () => xml(),
  },
  powershell: {
    name: "powershell",
    displayName: "PowerShell",
    extensions: [".ps1", ".psm1", ".psd1"],
    // Use XML as placeholder; PowerShell mode can be added later (NFR-004).
    getLanguage: () => xml(),
  },
  html: {
    name: "html",
    displayName: "HTML",
    extensions: [".html", ".htm", ".xhtml"],
    getLanguage: () => html(),
  },
  css: {
    name: "css",
    displayName: "CSS",
    extensions: [".css", ".scss", ".sass", ".less"],
    getLanguage: () => css(),
  },
  python: {
    name: "python",
    displayName: "Python",
    extensions: [".py", ".pyw"],
    getLanguage: () => python(),
  },
  sql: {
    name: "sql",
    displayName: "SQL",
    extensions: [".sql"],
    getLanguage: () => sql(),
  },
  json: {
    name: "json",
    displayName: "JSON",
    extensions: [".json", ".jsonc", ".json5"],
    getLanguage: () => json(),
  },
  yaml: {
    name: "yaml",
    displayName: "YAML",
    extensions: [".yaml", ".yml"],
    getLanguage: () => yaml(),
  },
  toml: {
    name: "toml",
    displayName: "TOML",
    extensions: [".toml"],
    // Use XML as placeholder for TOML; proper TOML mode can be added (NFR-004).
    getLanguage: () => xml(),
  },
};

/**
 * Detect language from file extension (best-effort heuristic).
 */
export function detectLanguageByExtension(filename: string): LanguageName | null {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  for (const [name, info] of Object.entries(LANGUAGE_REGISTRY)) {
    if (info.extensions.includes(ext)) {
      return name as LanguageName;
    }
  }
  return null;
}

/**
 * Get the CodeMirror language extension for a given language name.
 */
export function getLanguageExtension(lang: LanguageName): LanguageSupport {
  return LANGUAGE_REGISTRY[lang].getLanguage();
}

/**
 * All supported languages (for UI dropdown, etc.).
 */
export function getAllLanguages(): readonly LanguageInfo[] {
  return Object.values(LANGUAGE_REGISTRY);
}
