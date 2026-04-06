/**
 * Sid — the SidClaw Guard mascot.
 *
 * A friendly badger with claws and a shield.
 * Three moods matching the three decision types:
 *   happy    — shield up, all clear (allow)
 *   thinking — shield raised, uncertain (hold for approval)
 *   angry    — claws out, blocking (deny)
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
//  Sid — the badger guard
// ─────────────────────────────────────────────────

/**
 * Banner — Sid with product name. For demo and quickstart.
 */
export const SID_BANNER = `
${BR}    (\\  /)${R}
${BR}    ( ${C}o${R}${BR}.${C}o${R}${BR} )${R}     ${BOLD}S I D C L A W   G U A R D${R}
${BR}    /${R} ${B}[${BOLD}✓${R}${B}]${R} ${BR}\\${R}     ${D}MCP guardrails for dangerous tool calls${R}
${BR}   ^^${R}${B} ▀▀▀${R} ${BR}^^${R}
`;

/**
 * Mini — compact version for guard proxy startup.
 */
export const SID_MINI = [
  `${BR}(\\${C}o${BR}.${C}o${BR}/)${R}  ${BOLD}SidClaw Guard${R}`,
  `${BR} /${R}${B}[✓]${R}${BR}\\${R}   ${D}MCP guardrails${R}`,
].join('\n');

// ─────────────────────────────────────────────────
//  Inline reactions — 1 line each, after decisions
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
//  Flow checkpoint diagrams
// ─────────────────────────────────────────────────

export function flowAllow(_tool: string, summary: string): string {
  const s = summary.length > 35 ? summary.substring(0, 32) + '...' : summary;
  return `
${D}  ┌────────┐      ┌────────────┐      ┌──────────┐${R}
${D}  │${R} Agent  ${D}│${R}${C}─────▶${R}${D}│${R}${B} ▪ Guard ▪ ${R}${D}│${R}${G}─────▶${R}${D}│${R} Upstream ${D}│${R}
${D}  └────────┘      └─────┬──────┘      └──────────┘${R}
                        ${G}│${R}
                   ${G}✔ ALLOWED${R}
                   ${D}${s}${R}`;
}

export function flowHold(_tool: string, summary: string): string {
  const s = summary.length > 35 ? summary.substring(0, 32) + '...' : summary;
  return `
${D}  ┌────────┐      ┌────────────┐      ┌──────────┐${R}
${D}  │${R} Agent  ${D}│${R}${C}─────▶${R}${D}│${R}${B} ▪ Guard ▪ ${R}${D}│${R}${Y}──${BOLD}?${R}${Y}──▶${R}${D}│${R} Upstream ${D}│${R}
${D}  └────────┘      └─────┬──────┘      └──────────┘${R}
                        ${Y}│${R}
                   ${Y}⏳ HELD FOR APPROVAL${R}
                   ${D}${s}${R}`;
}

export function flowBlock(_tool: string, summary: string): string {
  const s = summary.length > 35 ? summary.substring(0, 32) + '...' : summary;
  return `
${D}  ┌────────┐      ┌────────────┐      ┌──────────┐${R}
${D}  │${R} Agent  ${D}│${R}${C}─────▶${R}${D}│${R}${B} ▪ Guard ▪ ${R}${D}│${R}  ${RED}╳${R}   ${D}│${R} Upstream ${D}│${R}
${D}  └────────┘      └─────┬──────┘      └──────────┘${R}
                        ${RED}│${R}
                   ${RED}✘ BLOCKED${R}
                   ${D}${s}${R}`;
}
