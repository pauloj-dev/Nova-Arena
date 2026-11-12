export interface ColorHit {
  line: number;
  column: number;
  match: string;
  text: string;
}
export interface ColorViolation extends ColorHit {
  file: string;
}
export interface FindColorsOptions {
  extensions?: string[];
  /** Nomes de arquivo ou caminhos relativos a `cwd` que podem conter cor. Padrão: `tokens.css`. */
  allow?: string[];
  cwd?: string;
}

export const DEFAULT_EXTENSIONS: string[];
export const DEFAULT_ALLOWED_FILES: string[];
export function findColorsInSource(source: string): ColorHit[];
export function findColors(dirs: string[], options?: FindColorsOptions): ColorViolation[];
