/**
 * Terminal art — Sid the crab mascot, flow visualizations.
 *
 * "Sid" is the SidClaw guard crab. Three moods:
 *   happy    — claws down, smiling (allow)
 *   thinking — claws out, uncertain (hold for approval)
 *   angry    — claws up, blocking (deny)
 */

// Colors
const R = '\x1b[0m';       // reset
const B = '\x1b[34m';      // blue
const G = '\x1b[32m';      // green
const Y = '\x1b[33m';      // yellow/amber
const RED = '\x1b[31m';    // red
const D = '\x1b[2m';       // dim
const BOLD = '\x1b[1m';    // bold
const C = '\x1b[36m';      // cyan
const M = '\x1b[35m';      // magenta

// ─────────────────────────────────────────────────
//  Sid — the SidClaw crab
// ─────────────────────────────────────────────────

/**
 * Sid: happy — claws down, all is well.
 * Shown when the guard allows a call.
 */
export const SID_HAPPY = `${B}      .~^~^~.${R}
${B} \\)${R}  ${B}/${R}  ${G}o   o${R}  ${B}\\${R}  ${B}(/${R}
${B}     ${R}|   ${G}\\${R}${G}_/${R}   |
${B}      \\_____/${R}`;

/**
 * Sid: thinking — claws out, uncertain, waiting.
 * Shown when a call needs approval.
 */
export const SID_THINKING = `${B}      .~^~^~.${R}
${B} \\)${R}  ${B}/${R}  ${Y}o   o${R}  ${B}\\${R}  ${B}(/${R}
${B}     ${R}|   ${Y}---${R}   |
${B}      \\_____/${R}`;

/**
 * Sid: angry — claws raised, blocking.
 * Shown when the guard denies a call.
 */
export const SID_ANGRY = `${B}      .~^~^~.${R}
${B} /)${R}  ${B}/${R}  ${RED}x   x${R}  ${B}\\${R}  ${B}(\\${R}
${B}     ${R}|   ${RED}___${R}   |
${B}      \\_____/${R}`;

/**
 * Sid: standing guard — the main banner.
 * Shown on demo start, quickstart.
 */
export const SID_BANNER = `
${B}          .~^~^~^~^~.${R}
${B}    \\)${R}   ${B}/${R}  ${C}o${R}       ${C}o${R}  ${B}\\${R}   ${B}(/  ${R}
${B}         ${R}|    ${BOLD}\\_/${R}     |
${B}          \\_________/${R}
${B}          / | | | | \\${R}
                            ${BOLD}S I D C L A W${R}
                            ${BOLD}G U A R D${R}
                            ${D}MCP guardrails${R}
`;

/**
 * Sid mini — compact inline version for guard startup.
 */
export const SID_MINI = `${B}.~^~.${R}
${B}/${R} ${C}o o${R} ${B}\\${R}  ${BOLD}SidClaw Guard${R}
${B}\\${R} ${D}v${R} ${B}/${R}   ${D}MCP guardrails${R}
${B} ~-~${R}`;

/**
 * Inline crab reactions — single line, shown after each decision.
 */
export function sidReaction(decision: 'allow' | 'deny' | 'approve'): string {
  switch (decision) {
    case 'allow':
      return `    ${B}\\)${R}${G}(^‿^)${R}${B}(/  ${R}${D}Looks safe!${R}`;
    case 'approve':
      return `    ${B}\\)${R}${Y}(°_°)${R}${B}(/  ${R}${D}Hmm, needs a human look...${R}`;
    case 'deny':
      return `    ${B}/)${R}${RED}(>_<)${R}${B}(\\  ${R}${D}Nope. Blocked.${R}`;
  }
}

// ─────────────────────────────────────────────────
//  Flow diagrams
// ─────────────────────────────────────────────────

/**
 * Flow diagram showing an ALLOWED tool call.
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

/**
 * Flow diagram showing a HELD tool call.
 */
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

/**
 * Flow diagram showing a BLOCKED tool call.
 */
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
 * Compact decision badge for list/audit display.
 */
export function badge(decision: 'allow' | 'deny' | 'approve'): string {
  switch (decision) {
    case 'allow': return `${G}▪ allow${R}`;
    case 'deny': return `${RED}▪ block${R}`;
    case 'approve': return `${Y}▪ hold${R}`;
  }
}
