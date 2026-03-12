/**
 * veraPDF integration tools for the MCP server.
 *
 * Shells out to the veraPDF CLI for deep PDF/UA (ISO 14289) validation.
 * veraPDF is the reference implementation used by the PDF Association,
 * Library of Congress, and EU accessibility bodies.
 *
 * All tools degrade gracefully — if veraPDF (Java 11+) is not installed,
 * they return a clear message explaining how to install it.
 *
 * Dependencies (external, optional):
 *   veraPDF CLI — https://verapdf.org/software/
 *   Requires: Java 11+
 *
 * Install:
 *   Download from https://docs.verapdf.org/install/
 *   Or via package managers:
 *     brew install verapdf          (macOS)
 *     choco install verapdf         (Windows)
 *     snap install verapdf          (Linux)
 */

import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { realpathSync, existsSync } from "node:fs";
import { homedir } from "node:os";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// veraPDF availability detection (lazy, cached)
// ---------------------------------------------------------------------------

let _veraPdfAvailable = undefined;

async function isVeraPdfAvailable() {
  if (_veraPdfAvailable !== undefined) return _veraPdfAvailable;
  try {
    await execFileAsync("verapdf", ["--version"], { timeout: 10000 });
    _veraPdfAvailable = true;
  } catch {
    _veraPdfAvailable = false;
  }
  return _veraPdfAvailable;
}

// ---------------------------------------------------------------------------
// Path validation (mirrors index.js pattern — read-only for veraPDF)
// ---------------------------------------------------------------------------

function validateReadPath(inputPath) {
  const resolved = resolve(inputPath);
  const home = homedir();
  const cwd = process.cwd();
  const underHome = resolved === home || resolved.startsWith(home + sep);
  const underCwd = resolved === cwd || resolved.startsWith(cwd + sep);
  if (!underHome && !underCwd) {
    throw new Error(
      `Path must be within your home directory or current working directory. Resolved: ${resolved}`
    );
  }
  // Resolve symlinks to prevent symlink-following attacks (CWE-59)
  if (existsSync(resolved)) {
    const real = realpathSync(resolved);
    const realUnderHome = real === home || real.startsWith(home + sep);
    const realUnderCwd = real === cwd || real.startsWith(cwd + sep);
    if (!realUnderHome && !realUnderCwd) {
      throw new Error(
        `Resolved symlink path outside allowed boundaries. Real: ${real}`
      );
    }
    return real;
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Matterhorn Protocol mapping — veraPDF rule IDs → our PDFUA rule IDs
// ---------------------------------------------------------------------------

const MATTERHORN_MAP = {
  // Structure
  "WCAG2.0-PDF9-1": "PDFUA.01.001",     // No /MarkInfo
  "WCAG2.0-PDF6-1": "PDFUA.02.001",     // Elements not in structure tree
  "ISO_19005_UA_1-1": "PDFUA.01.002",   // Marked false
  // Language
  "WCAG2.0-PDF16-1": "PDFUA.17.001",    // Missing /Lang
  "WCAG2.0-PDF19-1": "PDFUA.17.002",    // Invalid /Lang BCP-47
  // Alt text
  "WCAG2.0-PDF1-1": "PDFUA.03.001",     // Figure without /Alt
  // Tables
  "WCAG2.0-PDF6-2": "PDFUA.06.001",     // Table without TH
  "WCAG2.0-PDF6-3": "PDFUA.08.001",     // Headers attribute invalid
  // Forms
  "WCAG2.0-PDF12-1": "PDFUA.26.001",    // Form fields not tagged
  // Bookmarks / Navigation
  "WCAG2.0-PDF9-2": "PDFUA.19.001",     // Missing /Outlines
};

/**
 * Map a veraPDF ruleId to our internal PDFUA rule ID (best effort).
 */
function mapRuleId(veraRuleId) {
  return MATTERHORN_MAP[veraRuleId] || veraRuleId;
}

/**
 * Map veraPDF severity strings to our severity levels.
 */
function mapSeverity(status) {
  if (status === "failed") return "error";
  if (status === "passed") return "pass";
  return "warning";
}

// ---------------------------------------------------------------------------
// Parse veraPDF JSON output
// ---------------------------------------------------------------------------

function parseVeraPdfOutput(jsonStr) {
  const data = JSON.parse(jsonStr);
  const findings = [];

  // veraPDF JSON structure: report.jobs[].validationResult.details.rules[]
  const jobs = data?.report?.jobs || data?.jobs || [];
  for (const job of jobs) {
    const rules =
      job?.validationResult?.details?.rules ||
      job?.validationResult?.rules ||
      [];
    for (const rule of rules) {
      if (rule.status === "passed") continue;

      const ruleId = rule.specification
        ? `${rule.specification}-${rule.clause}-${rule.testNumber}`
        : rule.ruleId || "UNKNOWN";

      const checks = rule.checks || [];
      for (const check of checks) {
        if (check.status === "passed") continue;
        findings.push({
          ruleId: mapRuleId(ruleId),
          veraRuleId: ruleId,
          severity: mapSeverity(check.status),
          message: check.message || rule.description || "Validation failure",
          context: check.context || "",
          clause: rule.clause || "",
          testNumber: rule.testNumber || "",
          specification: rule.specification || "",
        });
      }

      // If no individual checks but rule failed overall
      if (checks.length === 0 && rule.status === "failed") {
        findings.push({
          ruleId: mapRuleId(ruleId),
          veraRuleId: ruleId,
          severity: "error",
          message: rule.description || "Validation failure",
          context: "",
          clause: rule.clause || "",
          testNumber: rule.testNumber || "",
          specification: rule.specification || "",
        });
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Register tool
// ---------------------------------------------------------------------------

export function registerVeraPdfTools(server) {
  server.registerTool(
    "run_verapdf_scan",
    {
      title: "Run veraPDF PDF/UA Scan",
      description:
        "Run veraPDF — the reference PDF/UA validator — against a PDF file. " +
        "Returns deep structural validation findings mapped to Matterhorn Protocol " +
        "checkpoints. Requires veraPDF CLI and Java 11+ (optional — degrades gracefully).",
      inputSchema: z.object({
        filePath: z
          .string()
          .describe("Absolute or relative path to the PDF file to scan."),
        flavour: z
          .enum(["ua1", "ua2", "1a", "1b", "2a", "2b", "2u", "3a", "3b", "3u", "4", "4e", "4f"])
          .default("ua1")
          .describe(
            "Validation flavour. ua1 = PDF/UA-1 (default). ua2 = PDF/UA-2. " +
            "1a/1b/2a/2b/2u/3a/3b/3u/4/4e/4f = PDF/A variants."
          ),
        maxFindings: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(200)
          .describe("Maximum findings to return (default 200, max 1000)."),
      }),
    },
    async ({ params }) => {
      // --- Availability check ---
      const available = await isVeraPdfAvailable();
      if (!available) {
        return {
          content: [
            {
              type: "text",
              text:
                "veraPDF is not installed or not on PATH.\n\n" +
                "veraPDF is the reference PDF/UA validator. Install it for deep structural validation:\n" +
                "  - Download: https://docs.verapdf.org/install/\n" +
                "  - macOS: brew install verapdf\n" +
                "  - Windows: choco install verapdf\n" +
                "  - Linux: snap install verapdf\n" +
                "  - Requires: Java 11+\n\n" +
                "The built-in scan_pdf_document tool will continue to work without veraPDF.",
            },
          ],
        };
      }

      // --- Path validation ---
      let resolvedPath;
      try {
        resolvedPath = validateReadPath(params.filePath);
      } catch (e) {
        return {
          content: [{ type: "text", text: `Path error: ${e.message}` }],
        };
      }

      // --- File existence + size check ---
      try {
        const info = await stat(resolvedPath);
        if (!info.isFile()) {
          return {
            content: [{ type: "text", text: `Not a file: ${resolvedPath}` }],
          };
        }
        if (info.size > 500 * 1024 * 1024) {
          return {
            content: [
              {
                type: "text",
                text: "File exceeds 500 MB limit for veraPDF scanning.",
              },
            ],
          };
        }
      } catch {
        return {
          content: [
            { type: "text", text: `File not found: ${resolvedPath}` },
          ],
        };
      }

      // --- Run veraPDF ---
      try {
        const args = [
          "--flavour",
          params.flavour,
          "--format",
          "json",
          resolvedPath,
        ];

        const { stdout, stderr } = await execFileAsync("verapdf", args, {
          timeout: 120000, // 2 min timeout
          maxBuffer: 50 * 1024 * 1024, // 50 MB output buffer
        });

        if (!stdout || stdout.trim().length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `veraPDF produced no output.${stderr ? `\nStderr: ${stderr.slice(0, 500)}` : ""}`,
              },
            ],
          };
        }

        // --- Parse output ---
        const findings = parseVeraPdfOutput(stdout);
        const truncated = findings.slice(0, params.maxFindings);

        const errors = truncated.filter((f) => f.severity === "error").length;
        const warnings = truncated.filter(
          (f) => f.severity === "warning"
        ).length;

        // --- Format results ---
        const lines = [
          `VERAPDF SCAN: ${resolvedPath}`,
          `Flavour: ${params.flavour}`,
          `Total findings: ${findings.length}${findings.length > params.maxFindings ? ` (showing first ${params.maxFindings})` : ""}`,
          `Errors: ${errors} | Warnings: ${warnings}`,
          "",
        ];

        for (const f of truncated) {
          lines.push(`[${f.severity.toUpperCase()}] ${f.ruleId}`);
          if (f.veraRuleId !== f.ruleId) {
            lines.push(`  veraPDF rule: ${f.veraRuleId}`);
          }
          lines.push(`  ${f.message}`);
          if (f.clause) lines.push(`  Clause: ${f.clause}`);
          if (f.context) lines.push(`  Context: ${f.context.slice(0, 200)}`);
          lines.push("");
        }

        if (findings.length === 0) {
          lines.push(
            "No violations found. This PDF passes " +
              `${params.flavour.toUpperCase()} validation.`
          );
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (e) {
        const msg =
          e.killed || e.signal === "SIGTERM"
            ? "veraPDF timed out (120s limit). Try a smaller PDF or increase timeout."
            : `veraPDF error: ${e.message?.slice(0, 500) || "Unknown error"}`;
        return {
          content: [{ type: "text", text: msg }],
        };
      }
    }
  );
}
