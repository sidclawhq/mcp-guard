/**
 * Terminal art — shield logo and flow visualizations.
 *
 * Uses ANSI colors and Unicode box-drawing characters.
 * Designed to render cleanly in any modern terminal.
 */

// Colors
const R = '\x1b[0m';       // reset
const B = '\x1b[34m';      // blue
const G = '\x1b[32m';      // green
const Y = '\x1b[33m';      // yellow
const RED = '\x1b[31m';    // red
const D = '\x1b[2m';       // dim
const BOLD = '\x1b[1m';    // bold
const W = '\x1b[37m';      // white
const C = '\x1b[36m';      // cyan

/**
 * Shield logo — shown on startup, quickstart, and demo.
 * ~9 lines tall, centered on a standard 80-column terminal.
 */
export const SHIELD = `
${B}        ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄${R}
${B}       █${D}▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓${R}${B}█${R}
${B}       █${D}▓${R}  ${BOLD}S I D C L A W${R}          ${D}${B}▓${R}${B}█${R}
${B}       █${D}▓${R}  ${BOLD}G U A R D${R}              ${D}${B}▓${R}${B}█${R}
${B}       █${D}▓${R}                        ${D}${B}▓${R}${B}█${R}
${B}       █${D}▓${R}  ${G}■${R} allow  ${Y}■${R} hold  ${RED}■${R} block ${D}${B}▓${R}${B}█${R}
${B}        █${D}▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓${R}${B}█${R}
${B}         ██${D}▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓${R}${B}██${R}
${B}           ████${D}▓▓▓▓▓▓▓▓▓▓${R}${B}████${R}
${B}               ████████████${R}
${B}                   ████${R}
${B}                    ██${R}
`;

/**
 * Compact shield — for guard proxy startup banner. 4 lines.
 */
export const SHIELD_MINI = `${B}  ▄██▄${R}
${B} █${D}▓▓▓▓${R}${B}█${R}  ${BOLD}SidClaw Guard${R}
${B}  █${D}▓▓${R}${B}█${R}   ${D}MCP guardrails${R}
${B}   ▀▀${R}`;

/**
 * Flow diagram showing a tool call passing through the guard.
 * Used in the demo for each decision.
 */
export function flowAllow(tool: string, summary: string): string {
  const s = summary.length > 35 ? summary.substring(0, 32) + '...' : summary;
  return `
${D}  ┌────────┐      ┌────────────┐      ┌──────────┐${R}
${D}  │${R} Agent  ${D}│${R}${C}─────▶${R}${D}│${R}${B} ▪ Guard ▪ ${R}${D}│${R}${G}─────▶${R}${D}│${R} Upstream ${D}│${R}
${D}  └────────┘      └─────┬──────┘      └──────────┘${R}
                        ${G}│${R}
                   ${G}✔ ALLOWED${R}
                   ${D}${s}${R}
`;
}

export function flowHold(tool: string, summary: string): string {
  const s = summary.length > 35 ? summary.substring(0, 32) + '...' : summary;
  return `
${D}  ┌────────┐      ┌────────────┐      ┌──────────┐${R}
${D}  │${R} Agent  ${D}│${R}${C}─────▶${R}${D}│${R}${B} ▪ Guard ▪ ${R}${D}│${R}${Y}──${BOLD}?${R}${Y}──▶${R}${D}│${R} Upstream ${D}│${R}
${D}  └────────┘      └─────┬──────┘      └──────────┘${R}
                        ${Y}│${R}
                   ${Y}⏳ HELD FOR APPROVAL${R}
                   ${D}${s}${R}
`;
}

export function flowBlock(tool: string, summary: string): string {
  const s = summary.length > 35 ? summary.substring(0, 32) + '...' : summary;
  return `
${D}  ┌────────┐      ┌────────────┐      ┌──────────┐${R}
${D}  │${R} Agent  ${D}│${R}${C}─────▶${R}${D}│${R}${B} ▪ Guard ▪ ${R}${D}│${R}  ${RED}╳${R}   ${D}│${R} Upstream ${D}│${R}
${D}  └────────┘      └─────┬──────┘      └──────────┘${R}
                        ${RED}│${R}
                   ${RED}✘ BLOCKED${R}
                   ${D}${s}${R}
`;
}

/**
 * Compact decision badge for the list/audit display.
 */
export function badge(decision: 'allow' | 'deny' | 'approve'): string {
  switch (decision) {
    case 'allow': return `${G}▪ allow${R}`;
    case 'deny': return `${RED}▪ block${R}`;
    case 'approve': return `${Y}▪ hold${R}`;
  }
}
