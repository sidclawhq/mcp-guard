/**
 * Sid — the SidClaw guard crab.
 *
 * Three moods matching the three decision types:
 *   happy    (^‿^)  claws down — allow
 *   thinking (°_°)  claws out  — hold for approval
 *   angry    (>_<)  claws up   — deny/block
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

// ─────────────────────────────────────────────────
//  Sid — full art (4 lines, compact)
// ─────────────────────────────────────────────────

export const SID_HAPPY = [
  `${B}    .~^~^~.${R}`,
  `${B}\\)${R} ${B}/${R}  ${G}^${R}   ${G}^${R}  ${B}\\${R} ${B}(/  ${R}`,
  `${B}   ${R}|  ${G}\\__/${R}  |`,
  `${B}    \\_____/${R}`,
].join('\n');

export const SID_THINKING = [
  `${B}    .~^~^~.${R}`,
  `${B}\\)${R} ${B}/${R}  ${Y}o${R}   ${Y}o${R}  ${B}\\${R} ${B}(/  ${R}`,
  `${B}   ${R}|  ${Y} -- ${R} |`,
  `${B}    \\_____/${R}`,
].join('\n');

export const SID_ANGRY = [
  `${B}    .~^~^~.${R}`,
  `${B}/)${R} ${B}/${R}  ${RED}>${R}   ${RED}<${R}  ${B}\\${R} ${B}(\\  ${R}`,
  `${B}   ${R}|  ${RED} /\\${R}  |`,
  `${B}    \\_____/${R}`,
].join('\n');

// ─────────────────────────────────────────────────
//  Banner — Sid + product name, 4 lines total
// ─────────────────────────────────────────────────

export const SID_BANNER = `
${B}    .~^~^~.${R}
${B}\\)${R} ${B}/${R}  ${C}o${R}   ${C}o${R}  ${B}\\${R} ${B}(/  ${R}  ${BOLD}S I D C L A W   G U A R D${R}
${B}   ${R}|  ${BOLD}\\__/${R}  |    ${D}MCP guardrails for dangerous tool calls${R}
${B}    \\_____/${R}
`;

// ─────────────────────────────────────────────────
//  Mini — for guard startup, 3 lines
// ─────────────────────────────────────────────────

export const SID_MINI = [
  `${B} .~^~.${R}`,
  `${B}/${R}${C}o${R}   ${C}o${R}${B}\\${R}  ${BOLD}SidClaw Guard${R}`,
  `${B} \\${R}${D}v${R}${B}/${R}    ${D}MCP guardrails${R}`,
].join('\n');

// ─────────────────────────────────────────────────
//  Inline reactions — 1 line each
// ─────────────────────────────────────────────────

export function sidReaction(decision: 'allow' | 'deny' | 'approve'): string {
  switch (decision) {
    case 'allow':
      return `    ${B}\\)${G}(^‿^)${B}(/  ${R}${D}Looks safe!${R}`;
    case 'approve':
      return `    ${B}\\)${Y}(°_°)${B}(/  ${R}${D}Hmm, let a human check this one...${R}`;
    case 'deny':
      return `    ${B}/)${RED}(>_<)${B}(\\  ${R}${D}No way. Blocked.${R}`;
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
