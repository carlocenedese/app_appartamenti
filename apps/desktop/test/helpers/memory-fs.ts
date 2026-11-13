import type { FsBackend } from '../../src/tauri-store';

/**
 * An in-memory file system with absolute `/` paths that tells NFC and NFD names apart (like ext4
 * and NTFS), and that fails the way the Tauri file plugin does: with an error for a missing file.
 */
export class MemoryFs implements FsBackend {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>(['/']);

  private parent(path: string): string {
    return path.slice(0, path.lastIndexOf('/')) || '/';
  }

  /** Test helper: puts a file on "disk" directly, creating its folders. */
  put(path: string, content: string | Uint8Array): void {
    this.mkdirSync(this.parent(path));
    this.files.set(path, typeof content === 'string' ? new TextEncoder().encode(content) : content);
  }

  /** The names directly inside `dir`, sorted, NFC-normalised. */
  names(dir: string): string[] {
    return [...this.files.keys(), ...this.dirs]
      .filter((path) => path !== '/' && this.parent(path) === dir)
      .map((path) => path.slice(path.lastIndexOf('/') + 1).normalize('NFC'))
      .sort();
  }

  private mkdirSync(path: string): void {
    if (this.files.has(path)) throw new Error(`File exists: ${path}`);
    if (path !== '/') this.mkdirSync(this.parent(path));
    this.dirs.add(path);
  }

  private file(path: string): Uint8Array {
    const bytes = this.files.get(path);
    if (bytes === undefined) throw new Error(`failed to open file at path: ${path}`);
    return bytes;
  }

  async readText(path: string): Promise<string> {
    // The plugin decodes with TextDecoder, which drops a byte order mark.
    return new TextDecoder().decode(this.file(path));
  }

  async writeText(path: string, text: string): Promise<void> {
    if (!this.dirs.has(this.parent(path)) || this.dirs.has(path)) {
      throw new Error(`failed to open file at path: ${path}`);
    }
    this.files.set(path, new TextEncoder().encode(text));
  }

  async rename(from: string, to: string): Promise<void> {
    const bytes = this.file(from);
    this.files.delete(from);
    this.files.set(to, bytes);
  }

  async readDir(path: string): Promise<{ name: string; isFile: boolean; isDirectory: boolean }[]> {
    if (!this.dirs.has(path)) throw new Error(`failed to read directory at path: ${path}`);
    const entries = [...this.files.keys(), ...this.dirs].filter(
      (entry) => entry !== '/' && this.parent(entry) === path,
    );
    return entries.map((entry) => ({
      name: entry.slice(entry.lastIndexOf('/') + 1),
      isFile: this.files.has(entry),
      isDirectory: this.dirs.has(entry),
    }));
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return this.file(path);
  }

  async mkdir(path: string): Promise<void> {
    this.mkdirSync(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }
}
