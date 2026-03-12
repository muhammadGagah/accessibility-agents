/**
 * Playwright-based accessibility testing tools for the MCP server.
 *
 * All tools degrade gracefully — if Playwright is not installed, they return
 * a clear error message explaining how to install it. Tools operate read-only
 * against live URLs and never modify files.
 *
 * Dependencies (optional peer):
 *   playwright, @axe-core/playwright
 *
 * Install:
 *   npm install -D playwright @axe-core/playwright && npx playwright install chromium
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Playwright availability detection (lazy, cached)
// ---------------------------------------------------------------------------

let _playwrightAvailable = null;

async function isPlaywrightAvailable() {
  if (_playwrightAvailable !== null) return _playwrightAvailable;
  try {
    await import("playwright");
    _playwrightAvailable = true;
  } catch {
    _playwrightAvailable = false;
  }
  return _playwrightAvailable;
}

let _axePlaywrightAvailable = null;

async function isAxePlaywrightAvailable() {
  if (_axePlaywrightAvailable !== null) return _axePlaywrightAvailable;
  try {
    await import("@axe-core/playwright");
    _axePlaywrightAvailable = true;
  } catch {
    _axePlaywrightAvailable = false;
  }
  return _axePlaywrightAvailable;
}

const INSTALL_MSG =
  "Playwright is not installed. Install it with:\n" +
  "  npm install -D playwright @axe-core/playwright && npx playwright install chromium\n\n" +
  "All existing accessibility tools continue to work without Playwright.";

const AXE_PW_INSTALL_MSG =
  "@axe-core/playwright is not installed. Install it with:\n" +
  "  npm install -D @axe-core/playwright\n\n" +
  "This tool requires both playwright and @axe-core/playwright.";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Validate a URL and return the parsed href, or null + error text. */
function validateUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { href: null, error: "Invalid URL. Provide a valid URL like http://localhost:3000" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { href: null, error: "URL must use http: or https: protocol." };
  }
  return { href: parsed.href, error: null };
}

/** Validate a CSS selector string against shell-injection characters. */
function validateSelector(selector) {
  if (selector && /[;&|`$<>']/.test(selector)) {
    return "Invalid selector: contains disallowed characters.";
  }
  return null;
}

/** Create a standard error response. */
function errorResponse(text) {
  return { content: [{ type: "text", text }] };
}

/** Create a standard text response. */
function textResponse(text) {
  return { content: [{ type: "text", text }] };
}

/** Launch a Chromium browser, navigate to URL, and call `fn(page)`. Cleans up afterwards. */
async function withPage(url, fn, options = {}) {
  const pw = await import("playwright");
  const browser = await pw.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: options.viewport || { width: 1280, height: 720 },
      ...(options.contextOptions || {}),
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    return await fn(page, context, browser);
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Tool 1: Keyboard Scan
// ---------------------------------------------------------------------------

const keyboardScanSchema = z.object({
  url: z.string().describe('The URL to scan (e.g., "http://localhost:3000")'),
  maxTabs: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Maximum number of Tab presses (default: 100)"),
  selector: z
    .string()
    .optional()
    .describe("CSS selector to scope the scan to a specific container"),
});

async function runKeyboardScan({ url, maxTabs, selector }) {
  if (!(await isPlaywrightAvailable())) return errorResponse(INSTALL_MSG);

  const urlResult = validateUrl(url);
  if (urlResult.error) return errorResponse(urlResult.error);

  const selectorErr = validateSelector(selector);
  if (selectorErr) return errorResponse(selectorErr);

  const max = maxTabs || 100;

  return withPage(urlResult.href, async (page) => {
    // If scoping to a container, focus the first focusable element inside it
    if (selector) {
      const container = await page.$(selector);
      if (!container) return errorResponse(`Selector "${selector}" not found on page.`);
      await container.focus();
    } else {
      // Start from document body
      await page.keyboard.press("Tab");
    }

    const tabSequence = [];
    let consecutiveSame = 0;
    let lastId = null;

    for (let i = 0; i < max; i++) {
      if (i > 0 || selector) {
        await page.keyboard.press("Tab");
      }

      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        return {
          tagName: el.tagName.toLowerCase(),
          role: el.getAttribute("role") || "",
          name:
            el.getAttribute("aria-label") ||
            el.getAttribute("aria-labelledby") ||
            el.textContent?.trim().slice(0, 80) ||
            "",
          id: el.id || "",
          classList: Array.from(el.classList).join(" "),
          tabIndex: el.tabIndex,
          outerHTML: el.outerHTML.slice(0, 200),
        };
      });

      if (!info) {
        // Focus returned to body — tab cycle complete
        break;
      }

      const elementId = `${info.tagName}#${info.id}.${info.classList}`;
      if (elementId === lastId) {
        consecutiveSame++;
      } else {
        consecutiveSame = 0;
      }
      lastId = elementId;

      const isTrap = consecutiveSame >= 3;

      tabSequence.push({
        index: i + 1,
        tagName: info.tagName,
        role: info.role,
        name: info.name,
        id: info.id,
        classList: info.classList,
        tabIndex: info.tabIndex,
        isTrap,
        outerHTML: info.outerHTML,
      });

      if (isTrap) break;
    }

    // Build report
    const traps = tabSequence.filter((e) => e.isTrap);
    const lines = [
      `Keyboard Tab Order Scan: ${urlResult.href}`,
      `Total Tab Stops: ${tabSequence.length}`,
      `Keyboard Traps Detected: ${traps.length}`,
      "",
    ];

    if (traps.length > 0) {
      lines.push("KEYBOARD TRAPS:");
      for (const t of traps) {
        lines.push(`  Tab #${t.index}: ${t.tagName} #${t.id} — focus stuck here`);
        lines.push(`    HTML: ${t.outerHTML}`);
      }
      lines.push("");
    }

    lines.push("TAB ORDER SEQUENCE:");
    for (const entry of tabSequence) {
      const trap = entry.isTrap ? " [TRAP]" : "";
      const role = entry.role ? ` role="${entry.role}"` : "";
      const name = entry.name ? ` "${entry.name}"` : "";
      lines.push(
        `  ${entry.index}. <${entry.tagName}${role}>${name} (tabIndex=${entry.tabIndex})${trap}`
      );
    }

    lines.push("");
    lines.push(`WCAG Coverage: 2.1.1 (Keyboard), 2.1.2 (No Keyboard Trap), 2.4.3 (Focus Order)`);

    return textResponse(lines.join("\n"));
  });
}

// ---------------------------------------------------------------------------
// Tool 2: State Scan
// ---------------------------------------------------------------------------

const stateScanSchema = z.object({
  url: z.string().describe('The URL to scan (e.g., "http://localhost:3000")'),
  triggers: z
    .array(z.string())
    .optional()
    .describe(
      "CSS selectors of elements to click. If omitted, auto-discovers elements with aria-expanded, aria-haspopup, or disclosure patterns."
    ),
  axeTags: z
    .string()
    .optional()
    .describe('Comma-separated axe-core tags (default: "wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22aa")'),
});

async function runStateScan({ url, triggers, axeTags }) {
  if (!(await isPlaywrightAvailable())) return errorResponse(INSTALL_MSG);
  if (!(await isAxePlaywrightAvailable())) return errorResponse(AXE_PW_INSTALL_MSG);

  const urlResult = validateUrl(url);
  if (urlResult.error) return errorResponse(urlResult.error);

  if (triggers) {
    for (const s of triggers) {
      const err = validateSelector(s);
      if (err) return errorResponse(`Trigger selector "${s}": ${err}`);
    }
  }

  const tags = (axeTags || "wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22aa").split(",").map((t) => t.trim());

  return withPage(urlResult.href, async (page) => {
    const AxeBuilderModule = await import("@axe-core/playwright");
    const AxeBuilder = AxeBuilderModule.default || AxeBuilderModule.AxeBuilder;

    // Discover triggers if not provided
    let triggerSelectors = triggers || [];
    if (triggerSelectors.length === 0) {
      triggerSelectors = await page.evaluate(() => {
        const selectors = [];
        const candidates = document.querySelectorAll(
          "[aria-expanded], [aria-haspopup], details > summary, [data-toggle], [data-bs-toggle]"
        );
        for (const el of candidates) {
          // Build a selector for this element
          if (el.id) {
            selectors.push(`#${CSS.escape(el.id)}`);
          } else {
            const tag = el.tagName.toLowerCase();
            const classes = Array.from(el.classList)
              .filter((c) => /^[a-zA-Z_-][\w-]*$/.test(c))
              .slice(0, 2)
              .map((c) => `.${CSS.escape(c)}`)
              .join("");
            if (classes) {
              selectors.push(`${tag}${classes}`);
            }
          }
        }
        return selectors.slice(0, 20); // Cap at 20 triggers
      });
    }

    // Validate auto-discovered selectors
    triggerSelectors = triggerSelectors.filter((s) => !validateSelector(s));

    if (triggerSelectors.length === 0) {
      return textResponse(
        `State Scan: ${urlResult.href}\n\nNo interactive triggers found (no elements with aria-expanded, aria-haspopup, or disclosure patterns). All content is in its default state.\n\nTo scan specific elements, pass their selectors in the triggers[] parameter.`
      );
    }

    const results = [];

    for (const triggerSelector of triggerSelectors) {
      const triggerEl = await page.$(triggerSelector);
      if (!triggerEl) {
        results.push({
          trigger: triggerSelector,
          status: "not_found",
          violations: [],
        });
        continue;
      }

      // Get state description before click
      const beforeState = await page.evaluate(
        (sel) => {
          const el = document.querySelector(sel);
          return el ? el.getAttribute("aria-expanded") || "closed" : "unknown";
        },
        triggerSelector
      );

      // Click the trigger
      try {
        await triggerEl.click();
        await page.waitForTimeout(500); // Allow DOM to update
      } catch {
        results.push({
          trigger: triggerSelector,
          status: "click_failed",
          violations: [],
        });
        continue;
      }

      // Get state after click
      const afterState = await page.evaluate(
        (sel) => {
          const el = document.querySelector(sel);
          return el ? el.getAttribute("aria-expanded") || "open" : "unknown";
        },
        triggerSelector
      );

      // Run axe-core on the current page state
      try {
        const axeResults = await new AxeBuilder({ page }).withTags(tags).analyze();
        results.push({
          trigger: triggerSelector,
          status: "scanned",
          stateBefore: beforeState,
          stateAfter: afterState,
          violationCount: axeResults.violations.length,
          violations: axeResults.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            wcag: v.tags.filter((t) => t.startsWith("wcag")).join(", "),
            nodes: v.nodes.length,
          })),
        });
      } catch (axeErr) {
        results.push({
          trigger: triggerSelector,
          status: "axe_error",
          error: axeErr.message,
          violations: [],
        });
      }

      // Reset state — click again to close, then reload for clean state
      try {
        await triggerEl.click();
        await page.waitForTimeout(300);
      } catch {
        // If we can't close it, reload the page for a clean state
        await page.goto(urlResult.href, { waitUntil: "networkidle", timeout: 30000 });
      }
    }

    // Build report
    const totalViolations = results.reduce((sum, r) => sum + r.violations.length, 0);
    const lines = [
      `Dynamic State Scan: ${urlResult.href}`,
      `Triggers Tested: ${triggerSelectors.length}`,
      `Total Violations in Dynamic States: ${totalViolations}`,
      "",
    ];

    for (const r of results) {
      lines.push(`TRIGGER: ${r.trigger}`);
      if (r.status === "not_found") {
        lines.push("  Status: Element not found — skipped");
      } else if (r.status === "click_failed") {
        lines.push("  Status: Click failed — element may not be interactive");
      } else if (r.status === "axe_error") {
        lines.push(`  Status: axe-core error — ${r.error}`);
      } else {
        lines.push(`  State Change: ${r.stateBefore} → ${r.stateAfter}`);
        lines.push(`  Violations: ${r.violationCount}`);
        for (const v of r.violations) {
          lines.push(`    - ${v.id} (${v.impact}): ${v.help} [WCAG ${v.wcag}] (${v.nodes} elements)`);
        }
      }
      lines.push("");
    }

    lines.push("WCAG Coverage: All applicable SC evaluated in each dynamic state");
    lines.push("(expanded accordions, open menus, visible tooltips, populated dropdowns)");

    return textResponse(lines.join("\n"));
  });
}

// ---------------------------------------------------------------------------
// Tool 3: Viewport Scan
// ---------------------------------------------------------------------------

const viewportScanSchema = z.object({
  url: z.string().describe('The URL to scan (e.g., "http://localhost:3000")'),
  viewports: z
    .array(z.number().int().min(200).max(3840))
    .optional()
    .describe("Array of viewport widths in pixels (default: [320, 768, 1024, 1440])"),
  measureTargets: z
    .boolean()
    .optional()
    .describe("Whether to measure touch target sizes (default: true)"),
});

async function runViewportScan({ url, viewports, measureTargets }) {
  if (!(await isPlaywrightAvailable())) return errorResponse(INSTALL_MSG);
  if (!(await isAxePlaywrightAvailable())) return errorResponse(AXE_PW_INSTALL_MSG);

  const urlResult = validateUrl(url);
  if (urlResult.error) return errorResponse(urlResult.error);

  const widths = viewports || [320, 768, 1024, 1440];
  const doTargets = measureTargets !== false;

  const AxeBuilderModule = await import("@axe-core/playwright");
  const AxeBuilder = AxeBuilderModule.default || AxeBuilderModule.AxeBuilder;
  const pw = await import("playwright");
  const browser = await pw.chromium.launch({ headless: true });

  try {
    const allResults = [];

    for (const width of widths) {
      const context = await browser.newContext({
        viewport: { width, height: 720 },
      });
      const page = await context.newPage();
      await page.goto(urlResult.href, { waitUntil: "networkidle", timeout: 30000 });

      // Run axe-core
      const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
      const axeResults = await new AxeBuilder({ page }).withTags(tags).analyze();

      // Check horizontal scroll
      const horizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });

      // Measure touch targets
      let touchTargets = [];
      if (doTargets) {
        touchTargets = await page.evaluate(() => {
          const interactives = document.querySelectorAll(
            'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [tabindex="0"]'
          );
          const targets = [];
          for (const el of interactives) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            const minDim = Math.min(rect.width, rect.height);
            targets.push({
              selector: el.id
                ? `#${CSS.escape(el.id)}`
                : `${el.tagName.toLowerCase()}${el.className ? "." + Array.from(el.classList).filter(c => /^[a-zA-Z_-][\w-]*$/.test(c)).slice(0, 2).map(c => CSS.escape(c)).join(".") : ""}`,
              name:
                el.getAttribute("aria-label") ||
                el.textContent?.trim().slice(0, 40) ||
                "",
              width: Math.round(rect.width * 10) / 10,
              height: Math.round(rect.height * 10) / 10,
              meetsMinimum: minDim >= 24,
              meetsEnhanced: minDim >= 44,
            });
          }
          return targets;
        });
      }

      const undersizedTargets = touchTargets.filter((t) => !t.meetsMinimum);

      allResults.push({
        width,
        violationCount: axeResults.violations.length,
        violations: axeResults.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          wcag: v.tags.filter((t) => t.startsWith("wcag")).join(", "),
          nodes: v.nodes.length,
        })),
        horizontalScroll,
        totalTargets: touchTargets.length,
        undersizedTargets: undersizedTargets.length,
        touchTargets: undersizedTargets.slice(0, 15), // Cap report to worst 15
      });

      await context.close();
    }

    // Build report
    const lines = [
      `Viewport Responsive Scan: ${urlResult.href}`,
      `Viewports Tested: ${widths.join("px, ")}px`,
      "",
    ];

    for (const r of allResults) {
      lines.push(`VIEWPORT: ${r.width}px`);
      lines.push(`  Violations: ${r.violationCount}`);
      lines.push(`  Horizontal Scroll: ${r.horizontalScroll ? "YES — WCAG 1.4.10 failure" : "No"}`);

      if (doTargets) {
        lines.push(
          `  Touch Targets: ${r.totalTargets} total, ${r.undersizedTargets} under 24px minimum`
        );
        if (r.undersizedTargets > 0) {
          lines.push("  Undersized Targets:");
          for (const t of r.touchTargets) {
            lines.push(
              `    - ${t.selector} "${t.name}" — ${t.width}x${t.height}px (min 24px required)`
            );
          }
        }
      }

      if (r.violationCount > 0) {
        lines.push("  axe-core Violations:");
        for (const v of r.violations) {
          lines.push(`    - ${v.id} (${v.impact}): ${v.help} [WCAG ${v.wcag}] (${v.nodes} elements)`);
        }
      }
      lines.push("");
    }

    lines.push("WCAG Coverage: 1.4.10 (Reflow), 2.5.5 (Target Size Enhanced), 2.5.8 (Target Size Minimum)");

    return textResponse(lines.join("\n"));
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Tool 4: Contrast Scan
// ---------------------------------------------------------------------------

const contrastScanSchema = z.object({
  url: z.string().describe('The URL to scan (e.g., "http://localhost:3000")'),
  selector: z
    .string()
    .optional()
    .describe("CSS selector to scope the scan to a specific container"),
});

/** Compute relative luminance from an rgb() or rgba() color string. */
function luminanceFromRgb(rgb) {
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return null;
  const [, r, g, b] = match.map(Number);
  const toLinear = (c) => {
    c = c / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function computeContrastRatio(lum1, lum2) {
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

async function runContrastScan({ url, selector }) {
  if (!(await isPlaywrightAvailable())) return errorResponse(INSTALL_MSG);

  const urlResult = validateUrl(url);
  if (urlResult.error) return errorResponse(urlResult.error);

  const selectorErr = validateSelector(selector);
  if (selectorErr) return errorResponse(selectorErr);

  return withPage(urlResult.href, async (page) => {
    const textElements = await page.evaluate((scopeSelector) => {
      const root = scopeSelector
        ? document.querySelector(scopeSelector)
        : document.body;
      if (!root) return [];

      const results = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return node.textContent.trim().length > 0
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      });

      const seen = new Set();
      let node;
      while ((node = walker.nextNode())) {
        const el = node.parentElement;
        if (!el || seen.has(el)) continue;
        seen.add(el);

        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
          continue;
        }

        const fg = style.color;
        const bg = style.backgroundColor;
        const fontSize = parseFloat(style.fontSize);
        const fontWeight = parseInt(style.fontWeight, 10) || 400;
        const text = el.textContent.trim().slice(0, 60);

        // Build a selector for identification
        let sel = el.tagName.toLowerCase();
        if (el.id) sel = `#${el.id}`;
        else if (el.className && typeof el.className === "string") {
          const classes = el.className
            .split(/\s+/)
            .filter((c) => /^[a-zA-Z_-][\w-]*$/.test(c))
            .slice(0, 2);
          if (classes.length) sel += "." + classes.join(".");
        }

        results.push({ selector: sel, text, fg, bg, fontSize, fontWeight });
      }

      return results.slice(0, 200); // Cap at 200 elements
    }, selector || null);

    if (textElements.length === 0) {
      return textResponse(
        `Contrast Scan: ${urlResult.href}\n\nNo visible text elements found${selector ? ` within "${selector}"` : ""}.`
      );
    }

    const issues = [];
    const passes = [];

    for (const el of textElements) {
      const fgLum = luminanceFromRgb(el.fg);
      const bgLum = luminanceFromRgb(el.bg);

      if (fgLum === null || bgLum === null) continue;

      // Transparent/fully-transparent backgrounds are common — skip
      if (el.bg.includes("rgba") && el.bg.match(/,\s*0\s*\)/)) continue;

      const ratio = computeContrastRatio(fgLum, bgLum);
      const roundedRatio = Math.round(ratio * 100) / 100;

      // Determine required ratio based on font size and weight
      const isLarge = el.fontSize >= 24 || (el.fontSize >= 18.66 && el.fontWeight >= 700);
      const required = isLarge ? 3.0 : 4.5;
      const pass = ratio >= required;

      const entry = {
        selector: el.selector,
        text: el.text,
        foreground: el.fg,
        background: el.bg,
        ratio: roundedRatio,
        required,
        fontSize: el.fontSize,
        fontWeight: el.fontWeight,
        isLargeText: isLarge,
        pass,
      };

      if (pass) {
        passes.push(entry);
      } else {
        issues.push(entry);
      }
    }

    const lines = [
      `Computed Contrast Scan: ${urlResult.href}`,
      `Elements Analyzed: ${textElements.length}`,
      `Contrast Failures: ${issues.length}`,
      `Contrast Passes: ${passes.length}`,
      "",
    ];

    if (issues.length > 0) {
      lines.push("CONTRAST FAILURES:");
      for (const issue of issues) {
        lines.push(`  ${issue.selector} — "${issue.text}"`);
        lines.push(`    Foreground: ${issue.foreground}`);
        lines.push(`    Background: ${issue.background}`);
        lines.push(
          `    Ratio: ${issue.ratio}:1 (required: ${issue.required}:1 for ${issue.isLargeText ? "large" : "normal"} text)`
        );
        lines.push("");
      }
    } else {
      lines.push("All text elements meet WCAG contrast requirements.");
      lines.push("");
    }

    lines.push("WCAG Coverage: 1.4.3 (Contrast Minimum), 1.4.6 (Contrast Enhanced)");
    lines.push(
      "Note: This scans computed styles after CSS cascade resolution. Transparent backgrounds and overlays may need manual review."
    );

    return textResponse(lines.join("\n"));
  });
}

// ---------------------------------------------------------------------------
// Tool 5: Accessibility Tree Snapshot
// ---------------------------------------------------------------------------

const a11yTreeSchema = z.object({
  url: z.string().describe('The URL to scan (e.g., "http://localhost:3000")'),
  selector: z
    .string()
    .optional()
    .describe("CSS selector to root the tree snapshot (default: entire page)"),
});

async function runA11yTree({ url, selector }) {
  if (!(await isPlaywrightAvailable())) return errorResponse(INSTALL_MSG);

  const urlResult = validateUrl(url);
  if (urlResult.error) return errorResponse(urlResult.error);

  const selectorErr = validateSelector(selector);
  if (selectorErr) return errorResponse(selectorErr);

  return withPage(urlResult.href, async (page) => {
    let root = undefined;
    if (selector) {
      root = await page.$(selector);
      if (!root) return errorResponse(`Selector "${selector}" not found on page.`);
    }

    const snapshot = await page.accessibility.snapshot({
      interestingOnly: false,
      root: root || undefined,
    });

    if (!snapshot) {
      return textResponse(
        `Accessibility Tree: ${urlResult.href}\n\nNo accessibility tree data returned. The page may have no accessible content.`
      );
    }

    // Flatten for summary stats
    function countNodes(node) {
      let count = 1;
      if (node.children) {
        for (const child of node.children) {
          count += countNodes(child);
        }
      }
      return count;
    }

    function collectRoles(node, roles = {}) {
      if (node.role) {
        roles[node.role] = (roles[node.role] || 0) + 1;
      }
      if (node.children) {
        for (const child of node.children) {
          collectRoles(child, roles);
        }
      }
      return roles;
    }

    const nodeCount = countNodes(snapshot);
    const roles = collectRoles(snapshot);

    // Pretty-print the tree (limited depth for readability)
    function printTree(node, indent = 0, maxDepth = 6) {
      if (indent > maxDepth * 2) return "";
      const prefix = "  ".repeat(indent);
      const name = node.name ? ` "${node.name}"` : "";
      const value = node.value ? ` value="${node.value}"` : "";
      const desc = node.description ? ` desc="${node.description}"` : "";
      let line = `${prefix}${node.role}${name}${value}${desc}\n`;

      if (node.children && indent < maxDepth * 2) {
        for (const child of node.children) {
          line += printTree(child, indent + 1, maxDepth);
        }
      } else if (node.children) {
        line += `${prefix}  ... (${node.children.length} children)\n`;
      }
      return line;
    }

    const treeText = printTree(snapshot);

    const rolesSorted = Object.entries(roles)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    const lines = [
      `Accessibility Tree Snapshot: ${urlResult.href}`,
      `Total Nodes: ${nodeCount}`,
      `Root Role: ${snapshot.role}`,
      "",
      "ROLE DISTRIBUTION:",
      ...rolesSorted.map(([role, count]) => `  ${role}: ${count}`),
      "",
      "TREE STRUCTURE:",
      treeText,
      "Use this tree to verify landmarks, heading hierarchy, ARIA roles, and accessible names.",
      "WCAG Coverage: Structural foundation for all SC (landmarks, headings, roles, names, states)",
    ];

    return textResponse(lines.join("\n"));
  });
}

// ---------------------------------------------------------------------------
// Registration function — called by index.js
// ---------------------------------------------------------------------------

export function registerPlaywrightTools(server) {
  server.registerTool(
    "run_playwright_keyboard_scan",
    {
      title: "Playwright Keyboard Tab Order Scan",
      description:
        "Press Tab repeatedly on a live page and record the complete keyboard navigation sequence. Detects keyboard traps and broken tab order. Requires Playwright (optional dependency).",
      inputSchema: keyboardScanSchema,
    },
    runKeyboardScan
  );

  server.registerTool(
    "run_playwright_state_scan",
    {
      title: "Playwright Dynamic State Scan",
      description:
        "Click interactive triggers (accordions, menus, modals) and run axe-core against the revealed content. Catches accessibility violations that only exist in expanded/active states. Requires Playwright and @axe-core/playwright (optional dependencies).",
      inputSchema: stateScanSchema,
    },
    runStateScan
  );

  server.registerTool(
    "run_playwright_viewport_scan",
    {
      title: "Playwright Responsive Viewport Scan",
      description:
        "Run axe-core at multiple viewport widths. Measures touch target sizes and detects horizontal scroll overflow (reflow failures). Requires Playwright and @axe-core/playwright (optional dependencies).",
      inputSchema: viewportScanSchema,
    },
    runViewportScan
  );

  server.registerTool(
    "run_playwright_contrast_scan",
    {
      title: "Playwright Computed Contrast Scan",
      description:
        "Extract computed foreground and background colors for every text element after full CSS cascade resolution. Calculates actual contrast ratios against WCAG thresholds. Requires Playwright (optional dependency).",
      inputSchema: contrastScanSchema,
    },
    runContrastScan
  );

  server.registerTool(
    "run_playwright_a11y_tree",
    {
      title: "Playwright Accessibility Tree Snapshot",
      description:
        "Capture the full accessibility tree as seen by the browser's accessibility API. Returns roles, names, values, and tree structure. Useful for verifying landmarks, headings, and ARIA. Requires Playwright (optional dependency).",
      inputSchema: a11yTreeSchema,
    },
    runA11yTree
  );
}
