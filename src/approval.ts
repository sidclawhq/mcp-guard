/**
 * File-based approval queue.
 *
 * When a tool call requires approval, a pending file is created.
 * A human reviews and approves/denies via the CLI or dashboard.
 * The guard polls the file for the decision.
 */

import {
  writeFileSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  unlinkSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { PendingApproval } from './types.js';

export class ApprovalQueue {
  private dir: string;
  private timeoutMs: number;

  constructor(dir: string = '.sidclaw/pending', timeoutMs: number = 300_000) {
    this.dir = dir;
    this.timeoutMs = timeoutMs;
    mkdirSync(dir, { recursive: true });
  }

  /**
   * Create a pending approval request.
   */
  create(
    tool: string,
    args: Record<string, unknown>,
    ruleName: string,
    reason?: string,
    explanation?: string,
  ): PendingApproval {
    const id = randomBytes(4).toString('hex');
    const approval: PendingApproval = {
      id,
      timestamp: new Date().toISOString(),
      tool,
      args,
      rule: ruleName,
      reason,
      explanation,
    };
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(approval, null, 2));
    return approval;
  }

  /**
   * Wait for a decision on a pending approval (polling).
   */
  async waitForDecision(id: string): Promise<'approved' | 'denied' | 'expired'> {
    const filePath = join(this.dir, `${id}.json`);
    const startTime = Date.now();

    while (Date.now() - startTime < this.timeoutMs) {
      try {
        const data = JSON.parse(readFileSync(filePath, 'utf-8')) as PendingApproval;
        if (data.decision) return data.decision;
      } catch {
        // File may be mid-write, retry
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    // Mark as expired
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8')) as PendingApproval;
      if (!data.decision) {
        data.decision = 'expired';
        data.decided_at = new Date().toISOString();
        writeFileSync(filePath, JSON.stringify(data, null, 2));
      }
    } catch { /* ignore */ }

    return 'expired';
  }

  /**
   * Record a decision (approve or deny).
   */
  decide(id: string, decision: 'approved' | 'denied'): PendingApproval {
    const filePath = join(this.dir, `${id}.json`);
    if (!existsSync(filePath)) {
      throw new Error(`No pending approval with id: ${id}`);
    }

    const data = JSON.parse(readFileSync(filePath, 'utf-8')) as PendingApproval;
    if (data.decision) {
      throw new Error(`Approval ${id} already decided: ${data.decision}`);
    }

    data.decision = decision;
    data.decided_at = new Date().toISOString();
    writeFileSync(filePath, JSON.stringify(data, null, 2));
    return data;
  }

  /**
   * List all pending (undecided) approvals.
   */
  list(): PendingApproval[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(readFileSync(join(this.dir, f), 'utf-8')) as PendingApproval;
        } catch {
          return null;
        }
      })
      .filter((a): a is PendingApproval => a !== null && !a.decision)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * Clean up stale approval files (decided or older than maxAge).
   * Returns count of files removed.
   */
  cleanup(maxAgeMs: number = 3600_000): number {
    if (!existsSync(this.dir)) return 0;
    const now = Date.now();
    let removed = 0;

    for (const f of readdirSync(this.dir).filter((f) => f.endsWith('.json'))) {
      const filePath = join(this.dir, f);
      try {
        const data = JSON.parse(readFileSync(filePath, 'utf-8')) as PendingApproval;

        // Remove decided approvals
        if (data.decision) {
          unlinkSync(filePath);
          removed++;
          continue;
        }

        // Remove stale undecided approvals (older than maxAge)
        const age = now - new Date(data.timestamp).getTime();
        if (age >= maxAgeMs) {
          unlinkSync(filePath);
          removed++;
        }
      } catch {
        // Corrupted file — remove it
        try { unlinkSync(filePath); removed++; } catch { /* ignore */ }
      }
    }

    return removed;
  }

  /**
   * Get the directory path.
   */
  getDir(): string {
    return this.dir;
  }
}
