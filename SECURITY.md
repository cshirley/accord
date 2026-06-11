# Security Policy

## Supported versions

Security fixes are applied to the latest release on the `main` branch. Older tags may not receive backports unless noted in a release announcement.

| Version | Supported |
| --- | --- |
| latest `main` | yes |
| older tags | best effort |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use one of these channels:

1. **[GitHub Private Security Advisories](https://github.com/cshirley/accord/security/advisories/new)** (preferred)
2. Email the maintainer via the contact address on their GitHub profile

Include as much detail as you can:

- Description of the issue and potential impact
- Steps to reproduce
- Affected versions or commits
- Any suggested fix or mitigation

You should receive an acknowledgement within a few business days. We will work with you on a fix and coordinated disclosure timeline.

## Scope

In scope:

- This repository's source code, bundled assets, schemas, and documented CI workflows
- Vulnerabilities that could affect users who install and run ACCORD as documented

Out of scope (report to the upstream project instead):

- Vulnerabilities in [Pi](https://pi.dev/), MCP servers, or third-party integrations you configure separately
- Misconfiguration of API keys, Jira tokens, or other secrets in your environment
- Social engineering or phishing unrelated to this codebase

## Safe usage reminders

- Never commit real API keys, Jira tokens, or PATs. Use `.env` (gitignored) or CI secrets.
- Review MCP server and provider configurations before enabling them in production workflows.
- Treat autopipeline and subagent features as powerful automation — restrict repository and secret access accordingly.
