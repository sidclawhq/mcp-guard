/**
 * Audit logger — append-only JSONL file.
 *
 * Every tool call decision is recorded for inspection and compliance.
 */

import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuditEntry } from './types.js';

export class AuditLog {
  private path: string;
  private disabled: boolean;

  constructor(path: string = '.sidclaw/audit.jsonl', disabled: boolean = false) {
    this.path = path;
    this.disabled = disabled;

    if (!disabled) {
      mkdirSync(dirname(path), { recursive: true });
    }
  }

  /**
   * Write an audit entry.
   */
  write(entry: AuditEntry): void {
    if (this.disabled) return;
    appendFileSync(this.path, JSON.stringify(entry) + '\n');
  }

  /**
   * Read all audit entries.
   */
  read(): AuditEntry[] {
    if (!existsSync(this.path)) return [];
    const content = readFileSync(this.path, 'utf-8').trim();
    if (!content) return [];
    return content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as AuditEntry);
  }

  /**
   * Get the audit log file path.
   */
  getPath(): string {
    return this.path;
  }
}
