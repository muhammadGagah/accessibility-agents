# Changelog

All notable changes to the Accessibility Agents project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Debug Panel Workflow Guide** - Added user-facing troubleshooting guide for VS Code Agent Debug Panel workflows in `docs/guides/debug-panel-workflows.md`
  - Covers instruction loading checks, handoff validation, tool failure triage, and browser verification troubleshooting
  - Includes a reproducible issue report checklist for deterministic debugging

### Changed

- **Source Verification Coverage** - Expanded source verification workflow triggers to include:
  - `claude-code-plugin/agents/**/*.md`
  - `scripts/verify-sources.py`
  - `.github/agents/SOURCE_REGISTRY.json`
- **Source Currency Automation** - `source-currency-check.yml` now runs on relevant `pull_request` and `push` events in addition to weekly schedule
- **Source Validation Performance** - Added URL-level caching in `scripts/verify-sources.py` to avoid duplicate network calls during large scans

### Fixed

- **Operational Citation Backlog** - Added missing `## Authoritative Sources` sections to all remaining Claude-side agent files:
  - `.claude/agents/*.md` now fully covered
  - `claude-code-plugin/agents/web-csv-reporter.md` now aligned

## [3.0.0] - 2026-03-04

### Added

- **Authoritative Sources Citations** - All 113 agents now cite official W3C, vendor, and platform documentation
  - 57 GitHub Copilot agents (`.github/agents/*.agent.md`) cite WCAG 2.2, ARIA 1.2, axe-core, platform APIs, and vendor docs
  - 56 Claude Code agents (`.claude/agents/*.md`) cite the same authoritative sources
  - Sources organized by domain: web (WCAG/ARIA), documents (PDF/UA, Office, EPUB), markdown (CommonMark), GitHub (REST/GraphQL API), developer tools (Python, wxPython, platform accessibility APIs)
  
- **Citation Policy Framework** - Infrastructure for source validation and authority hierarchy
  - Tier 1 (Normative): W3C specifications (WCAG 2.2, ARIA 1.2, HTML Living Standard)
  - Tier 2 (Informative): Understanding WCAG, ARIA APG
  - Tier 3 (Vendor): Microsoft Learn, Apple Developer, wxPython Docs
  - Tier 4 (AT): NVDA, JAWS, VoiceOver documentation
  - Tier 5 (Community): Deque University, WebAIM, Adrian Roselli
  - Tier 6 (Compliance): Section 508, EN 301 549

- **Per-Agent Source Registries** - Each agent documents its authoritative sources at the top of the file
  - Web agents cite WCAG 2.2, ARIA 1.2, axe-core, HTML Living Standard
  - Document agents cite PDF/UA-1 (ISO 14289-1:2023), Microsoft Office Accessibility, Open XML specs, Matterhorn Protocol
  - Markdown agents cite CommonMark, markdownlint, GitHub Flavored Markdown
  - GitHub workflow agents cite GitHub REST API, GraphQL API, GitHub CLI, Search Syntax
  - Developer agents cite Python docs, PyInstaller, pytest, mypy, wxPython, platform accessibility APIs (UI Automation, NSAccessibility, AT-SPI)

### Changed

- **Agent Credibility** - All agents now ground recommendations in published standards instead of "AI-generated" advice
- **Version Bump** - Project version 2.6 → 3.0 to reflect major architectural change (authoritative sourcing)

### Fixed

- **Trust Gap** - Users can now verify agent recommendations by following inline citations to official documentation

---

## [2.6.0] - 2026-03-03

### Added

- Initial public release with 113 accessibility agents across 5 teams
- Web Accessibility team (17 agents)
- Document Accessibility team (7 agents) 
- GitHub Workflow team (11 agents)
- Developer Tools team (7 agents)
- Cross-platform support: Claude Code, GitHub Copilot, Gemini CLI, Claude Desktop (MCP), Codex CLI

---

[Unreleased]: https://github.com/Community-Access/accessibility-agents/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/Community-Access/accessibility-agents/compare/v2.6.0...v3.0.0
[2.6.0]: https://github.com/Community-Access/accessibility-agents/releases/tag/v2.6.0
