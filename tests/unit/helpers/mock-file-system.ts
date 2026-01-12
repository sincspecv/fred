/**
 * Mock file system for testing file operations
 * This is a simple in-memory file system
 */
export class MockFileSystem {
  private files: Map<string, string> = new Map();
  private directories: Set<string> = new Set();

  /**
   * Create a file with content
   */
  createFile(path: string, content: string): void {
    this.files.set(path, content);
    // Ensure parent directory exists
    const dir = path.substring(0, path.lastIndexOf('/'));
    if (dir) {
      this.directories.add(dir);
    }
  }

  /**
   * Create a directory
   */
  createDirectory(path: string): void {
    this.directories.add(path);
  }

  /**
   * Read a file
   */
  readFile(path: string): string | null {
    return this.files.get(path) || null;
  }

  /**
   * Check if file exists
   */
  fileExists(path: string): boolean {
    return this.files.has(path);
  }

  /**
   * Check if directory exists
   */
  directoryExists(path: string): boolean {
    return this.directories.has(path);
  }

  /**
   * Delete a file
   */
  deleteFile(path: string): void {
    this.files.delete(path);
  }

  /**
   * Clear all files and directories
   */
  clear(): void {
    this.files.clear();
    this.directories.clear();
  }

  /**
   * Get all file paths
   */
  getAllFiles(): string[] {
    return Array.from(this.files.keys());
  }
}
