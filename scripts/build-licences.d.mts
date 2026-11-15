// Types for scripts/build-licences.mjs, so the test in src/ can import it.
export interface ShippedPackage {
  name: string;
  version: string;
  licence: string;
  home: string | null;
  why: string;
  dir: string;
  deps: string[];
  texts: { file: string; text: string }[];
}
export const ROOT: string;
export const NOTICES_FILE: string;
export function packageName(specifier: string): string | null;
export function importedPackages(root?: string): string[];
export function shippedPackages(root?: string): { app: ShippedPackage[]; tools: ShippedPackage[] };
export function renderNotices(root?: string): string;
