/** Types for tools/browser.mjs (puppeteer-core is not a dependency of the repo; the harness installs it into $ELS_BROWSER_DIR). */
export interface BrowserPage {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  evaluate<T = unknown>(pageFunction: string | (() => T | Promise<T>)): Promise<T>;
  waitForFunction(pageFunction: string, options?: { timeout?: number; polling?: number | string }): Promise<unknown>;
  screenshot(options?: { path?: string; fullPage?: boolean }): Promise<unknown>;
  setViewport(viewport: { width: number; height: number; deviceScaleFactor?: number }): Promise<void>;
}
export type BrowserLog = string[] & { errors: number };
export const CHROME_FLAGS: string[];
export function withPage<T>(fn: (page: BrowserPage, log: BrowserLog) => Promise<T>, options?: { size?: [number, number]; flags?: string[] }): Promise<T>;
