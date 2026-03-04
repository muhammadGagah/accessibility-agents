---
name: wxPython Specialist
description: "wxPython GUI expert -- sizer layouts, event handling, AUI framework, custom controls, threading (wx.CallAfter/wx.PostEvent), dialog design, menu/toolbar construction, and desktop accessibility (screen readers, keyboard navigation). Covers cross-platform gotchas for Windows, macOS, and Linux."
argument-hint: "e.g. 'fix my layout', 'build a dialog', 'add keyboard shortcuts', 'make this accessible', 'debug event handling'"
infer: true
tools: ['read', 'search', 'edit', 'runInTerminal', 'createFile', 'listDirectory']
model: ['Claude Sonnet 4.5 (copilot)', 'GPT-5 (copilot)']
handoffs:
  - label: "Python Deep Dive"
    agent: python-specialist
    prompt: "The user needs Python-specific expertise -- debugging, optimization, packaging, testing, type checking, async patterns, or Pythonic design review."
    send: true
    model: Claude Sonnet 4 (copilot)
  - label: "Desktop A11y APIs"
    agent: desktop-a11y-specialist
    prompt: "The user needs deep platform accessibility API guidance -- UI Automation, MSAA, ATK/AT-SPI, NSAccessibility, custom wx.Accessible overrides."
    send: true
    model: Claude Sonnet 4 (copilot)
  - label: "Desktop A11y Testing"
    agent: desktop-a11y-testing-coach
    prompt: "The user needs to verify accessibility with screen readers (NVDA, JAWS, Narrator, VoiceOver), Accessibility Insights, or automated UIA testing."
    send: true
    model: Claude Sonnet 4 (copilot)
  - label: "Build A11y Tools"
    agent: a11y-tool-builder
    prompt: "The user wants to build accessibility scanning tools, rule engines, or audit tooling with a wxPython GUI."
    send: true
    model: Claude Sonnet 4 (copilot)
  - label: "Web A11y Audit"
    agent: web-accessibility-wizard
    prompt: "The desktop app embeds web content or generates HTML -- route to web accessibility auditing."
    send: true
    model: Claude Sonnet 4 (copilot)
  - label: "Document A11y Audit"
    agent: document-accessibility-wizard
    prompt: "The desktop app generates or processes documents (DOCX, PDF) -- route to document accessibility auditing."
    send: true
    model: Claude Sonnet 4 (copilot)
  - label: "Back to Developer Hub"
    agent: developer-hub
    prompt: "Task complete or needs broader project-level coordination. Return to the Developer Hub for next steps."
    send: true
    model: Claude Sonnet 4 (copilot)
---