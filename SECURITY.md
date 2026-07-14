# Security Policy

## Supported versions

Security fixes are released for the latest published version of
`sidclaw-mcp-guard`. Please upgrade to the newest release before reporting an
issue where possible.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue or PR,
and do not include working destructive payloads in the initial report.

Two ways to reach us:

1. **GitHub Security Advisories (preferred):** open a private report from the
   repository's **Security** tab → **Report a vulnerability**. This keeps the
   discussion private and lets us issue a fix and request a CVE with credit.
2. **Email:** `hello@sidclaw.com`. Plain-text write-ups are welcome; note that
   some mailboxes reject executable attachments (e.g. `.mjs`), so inline text or
   a link to a private gist is safer than an attachment.

Please include: affected version, a description of the flaw, and a minimal
proof-of-concept (a harmless placeholder in place of any destructive command is
fine).

## What to expect

- **Acknowledgement:** we aim to confirm receipt within **3 business days**.
- **Assessment & fix:** we will reproduce, assess severity, and work on a fix,
  keeping you updated.
- **Disclosure:** we coordinate public disclosure with the reporter. We are happy
  to publish a GitHub Security Advisory, request a CVE, and credit you (by name or
  handle, or anonymously — your choice).

## Scope

`sidclaw-mcp-guard` is a policy proxy that classifies MCP tool calls as
allow / approve / deny. The most impactful issues are those that let a call which
should be **denied** or **held for approval** be classified **allow** and
forwarded to the wrapped server. Reports demonstrating such a policy bypass are
especially valued.

Thank you for helping keep mcp-guard and its users safe.
