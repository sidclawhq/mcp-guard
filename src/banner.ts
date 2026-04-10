/**
 * Sid — the SidClaw Guard mascot.
 *
 * A friendly badger with claws and a shield.
 */

// Colors
const R = '\x1b[0m';
const B = '\x1b[34m';
const G = '\x1b[32m';
const Y = '\x1b[33m';
const RED = '\x1b[31m';
const D = '\x1b[2m';
const BOLD = '\x1b[1m';
const C = '\x1b[36m';
const BR = '\x1b[33m';     // brown (yellow serves as brown)

// ─────────────────────────────────────────────────
//  Banners
// ─────────────────────────────────────────────────

/**
 * Banner — Sid with product name. For demo and quickstart.
 */
export const SID_BANNER = `
${BR}  (\\  /)${R}
${BR}  ( ${C}o${R}${BR}.${C}o${R}${BR} )${R}  ${BOLD}SidClaw Guard${R}
${BR}   /${R}${B}[${BOLD}✓${R}${B}]${R}${BR}\\${R}   ${D}MCP guardrails for dangerous tool calls${R}
`;

/**
 * Mini — compact version for guard proxy startup.
 */
export const SID_MINI = [
  `${BR}(\\${C}o${BR}.${C}o${BR}/)${R}  ${BOLD}SidClaw Guard${R}`,
  `${BR} /${R}${B}[✓]${R}${BR}\\${R}   ${D}MCP guardrails${R}`,
].join('\n');

// ─────────────────────────────────────────────────
//  Inline reactions — used by guard proxy at runtime
// ─────────────────────────────────────────────────

export function sidReaction(decision: 'allow' | 'deny' | 'approve'): string {
  switch (decision) {
    case 'allow':
      return `    ${BR}(\\${G}^${BR}.${G}^${BR}/)${R} ${B}[${G}✓${B}]${R}  ${D}Looks safe!${R}`;
    case 'approve':
      return `    ${BR}(\\${Y}o${BR}.${Y}o${BR}/)${R} ${B}[${Y}?${B}]${R}  ${D}Hmm, let a human check this one...${R}`;
    case 'deny':
      return `    ${BR}(\\${RED}>${BR}.${RED}<${BR}/)${R} ${B}[${RED}✘${B}]${R}  ${D}No way. Blocked.${R}`;
  }
}

// ─────────────────────────────────────────────────
//  Decision formatters — one compact block each
// ─────────────────────────────────────────────────

export function fmtAllow(sql: string, explanation: string, mockResult?: string): string {
  let out = `  ${G}✔ ALLOW${R}   ${sql}\n`;
  out += `  ${D}         ${explanation}${R}\n`;
  if (mockResult) out += `  ${D}         → ${mockResult}${R}\n`;
  return out;
}

export function fmtHold(sql: string, explanation: string, mockResult?: string): string {
  let out = `  ${Y}⏳ HOLD${R}    ${sql}\n`;
  out += `  ${D}         ${explanation}${R}\n`;
  if (mockResult) out += `  ${D}         → Would forward after approval: ${mockResult}${R}\n`;
  return out;
}

export function fmtBlock(sql: string, explanation: string): string {
  let out = `  ${RED}✘ BLOCK${R}   ${sql}\n`;
  out += `  ${D}         ${explanation}${R}\n`;
  return out;
}
