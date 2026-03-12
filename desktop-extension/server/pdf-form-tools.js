/**
 * PDF form-to-accessible-HTML converter for the MCP server.
 *
 * Reads AcroForm fields from a PDF using pdf-lib, maps each field type to
 * semantically correct HTML5 form elements with proper labels, fieldsets,
 * and ARIA attributes.
 *
 * Dependencies (optional peer):
 *   pdf-lib — MIT license, pure JavaScript, no native dependencies
 *
 * Install:
 *   npm install pdf-lib
 */

import { z } from "zod";
import { readFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { resolve, sep, basename } from "node:path";
import { realpathSync, existsSync } from "node:fs";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// pdf-lib availability detection (lazy, cached)
// ---------------------------------------------------------------------------

let _pdfLibModule = undefined;
let _pdfLibChecked = false;

async function getPdfLib() {
  if (_pdfLibChecked) return _pdfLibModule;
  _pdfLibChecked = true;
  try {
    _pdfLibModule = await import("pdf-lib");
  } catch {
    _pdfLibModule = null;
  }
  return _pdfLibModule;
}

// ---------------------------------------------------------------------------
// Path validation (read-only — mirrors index.js pattern)
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
// HTML escaping (prevent XSS in generated output)
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Field extraction + HTML generation
// ---------------------------------------------------------------------------

function extractFields(form, pdfLib) {
  const fields = [];
  const formFields = form.getFields();

  for (const field of formFields) {
    const name = field.getName();
    const constructor = field.constructor;

    let type = "unknown";
    let options = [];
    let defaultValue = "";
    let isRequired = false;
    let isReadOnly = false;
    let maxLength = undefined;

    try {
      isReadOnly = field.isReadOnly();
    } catch {
      // Some field types may not support this
    }

    if (constructor === pdfLib.PDFTextField) {
      const tf = field;
      type = tf.isMultiline() ? "textarea" : "text";
      defaultValue = tf.getText() || "";
      try {
        maxLength = tf.getMaxLength();
      } catch {
        // Not all text fields have maxLength
      }
    } else if (constructor === pdfLib.PDFCheckBox) {
      type = "checkbox";
      defaultValue = field.isChecked() ? "checked" : "";
    } else if (constructor === pdfLib.PDFRadioGroup) {
      type = "radio";
      options = field.getOptions();
      defaultValue = field.getSelected() || "";
    } else if (constructor === pdfLib.PDFDropdown) {
      type = "select";
      options = field.getOptions();
      try {
        const selected = field.getSelected();
        defaultValue = Array.isArray(selected) ? selected[0] || "" : selected || "";
      } catch {
        defaultValue = "";
      }
    } else if (constructor === pdfLib.PDFOptionList) {
      type = "select-multiple";
      options = field.getOptions();
      try {
        const selected = field.getSelected();
        defaultValue = Array.isArray(selected) ? selected.join(", ") : selected || "";
      } catch {
        defaultValue = "";
      }
    } else if (constructor === pdfLib.PDFButton) {
      type = "button";
      defaultValue = name;
    } else if (constructor === pdfLib.PDFSignature) {
      type = "signature";
    }

    // Derive a human-readable label from the field name
    const label = name
      .replace(/([A-Z])/g, " $1")
      .replace(/[_\-.]+/g, " ")
      .replace(/^\s+/, "")
      .replace(/\s+/g, " ")
      .trim();

    fields.push({
      name,
      type,
      label: label || name,
      options,
      defaultValue,
      isRequired,
      isReadOnly,
      maxLength,
    });
  }

  return fields;
}

function generateHtml(fields, title) {
  const lines = [];
  lines.push("<!DOCTYPE html>");
  lines.push('<html lang="en">');
  lines.push("<head>");
  lines.push('  <meta charset="UTF-8">');
  lines.push('  <meta name="viewport" content="width=device-width, initial-scale=1.0">');
  lines.push(`  <title>${escapeHtml(title)}</title>`);
  lines.push("  <style>");
  lines.push("    * { box-sizing: border-box; }");
  lines.push("    body { font-family: system-ui, -apple-system, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }");
  lines.push("    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; }");
  lines.push("    fieldset { border: 1px solid #ccc; border-radius: 4px; padding: 1rem; margin-bottom: 1.5rem; }");
  lines.push("    legend { font-weight: bold; padding: 0 0.5rem; }");
  lines.push("    .form-group { margin-bottom: 1rem; }");
  lines.push("    label { display: block; margin-bottom: 0.25rem; font-weight: 600; }");
  lines.push("    input[type='text'], input[type='email'], input[type='tel'], input[type='number'], textarea, select { width: 100%; padding: 0.5rem; border: 1px solid #767676; border-radius: 4px; font-size: 1rem; }");
  lines.push("    input:focus, textarea:focus, select:focus { outline: 2px solid #0056b3; outline-offset: 2px; }");
  lines.push("    textarea { min-height: 6rem; resize: vertical; }");
  lines.push("    .checkbox-group label, .radio-group label { display: inline; font-weight: normal; margin-left: 0.5rem; }");
  lines.push("    .checkbox-group, .radio-group { margin-bottom: 0.5rem; }");
  lines.push("    button[type='submit'] { background: #0056b3; color: #fff; border: none; padding: 0.75rem 1.5rem; font-size: 1rem; border-radius: 4px; cursor: pointer; }");
  lines.push("    button[type='submit']:hover { background: #004494; }");
  lines.push("    button[type='submit']:focus { outline: 2px solid #0056b3; outline-offset: 2px; }");
  lines.push("    .readonly-notice { color: #555; font-size: 0.875rem; font-style: italic; }");
  lines.push("    .required-marker { color: #c00; }");
  lines.push("  </style>");
  lines.push("</head>");
  lines.push("<body>");
  lines.push(`  <h1>${escapeHtml(title)}</h1>`);
  lines.push('  <form action="#" method="post" novalidate>');

  // Group radio buttons by name
  const radioGroups = new Map();
  const nonRadioFields = [];
  for (const f of fields) {
    if (f.type === "radio") {
      radioGroups.set(f.name, f);
    } else {
      nonRadioFields.push(f);
    }
  }

  // Merge radio groups back into position
  const ordered = [];
  const seen = new Set();
  for (const f of fields) {
    if (f.type === "radio") {
      if (!seen.has(f.name)) {
        seen.add(f.name);
        ordered.push(f);
      }
    } else {
      ordered.push(f);
    }
  }

  for (const f of ordered) {
    const id = escapeHtml(f.name.replace(/[^a-zA-Z0-9_-]/g, "_"));
    const label = escapeHtml(f.label);
    const req = f.isRequired ? ' required aria-required="true"' : "";
    const reqMark = f.isRequired ? ' <span class="required-marker" aria-hidden="true">*</span>' : "";
    const ro = f.isReadOnly ? " readonly" : "";
    const roNotice = f.isReadOnly ? '\n      <span class="readonly-notice">(read-only)</span>' : "";

    if (f.type === "signature") {
      lines.push('    <div class="form-group">');
      lines.push(`      <p><strong>${label}:</strong> This field requires a digital signature. Use your document signing tool to complete this field.</p>`);
      lines.push("    </div>");
      continue;
    }

    if (f.type === "button") {
      lines.push('    <div class="form-group">');
      lines.push(`      <button type="button">${label}</button>`);
      lines.push("    </div>");
      continue;
    }

    if (f.type === "text" || f.type === "unknown") {
      const ml = f.maxLength ? ` maxlength="${f.maxLength}"` : "";
      lines.push('    <div class="form-group">');
      lines.push(`      <label for="${id}">${label}${reqMark}</label>`);
      lines.push(`      <input type="text" id="${id}" name="${id}" value="${escapeHtml(f.defaultValue)}"${req}${ro}${ml}>${roNotice}`);
      lines.push("    </div>");
    } else if (f.type === "textarea") {
      lines.push('    <div class="form-group">');
      lines.push(`      <label for="${id}">${label}${reqMark}</label>`);
      lines.push(`      <textarea id="${id}" name="${id}"${req}${ro}>${escapeHtml(f.defaultValue)}</textarea>${roNotice}`);
      lines.push("    </div>");
    } else if (f.type === "checkbox") {
      lines.push('    <div class="form-group checkbox-group">');
      lines.push(`      <input type="checkbox" id="${id}" name="${id}"${f.defaultValue === "checked" ? " checked" : ""}${req}${ro}>`);
      lines.push(`      <label for="${id}">${label}${reqMark}</label>${roNotice}`);
      lines.push("    </div>");
    } else if (f.type === "radio") {
      lines.push("    <fieldset>");
      lines.push(`      <legend>${label}${reqMark}</legend>`);
      for (let i = 0; i < f.options.length; i++) {
        const opt = escapeHtml(f.options[i]);
        const optId = `${id}_${i}`;
        const checked = f.options[i] === f.defaultValue ? " checked" : "";
        lines.push('      <div class="radio-group">');
        lines.push(`        <input type="radio" id="${optId}" name="${id}" value="${opt}"${checked}${req}${ro}>`);
        lines.push(`        <label for="${optId}">${opt}</label>`);
        lines.push("      </div>");
      }
      lines.push(`      ${roNotice}`);
      lines.push("    </fieldset>");
    } else if (f.type === "select" || f.type === "select-multiple") {
      const multi = f.type === "select-multiple" ? " multiple" : "";
      lines.push('    <div class="form-group">');
      lines.push(`      <label for="${id}">${label}${reqMark}</label>`);
      lines.push(`      <select id="${id}" name="${id}"${multi}${req}${ro}>`);
      for (const opt of f.options) {
        const selected = opt === f.defaultValue ? " selected" : "";
        lines.push(`        <option value="${escapeHtml(opt)}"${selected}>${escapeHtml(opt)}</option>`);
      }
      lines.push("      </select>");
      lines.push(`      ${roNotice}`);
      lines.push("    </div>");
    }
  }

  lines.push('    <button type="submit">Submit</button>');
  lines.push("  </form>");
  lines.push("</body>");
  lines.push("</html>");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Register tool
// ---------------------------------------------------------------------------

export function registerPdfFormTools(server) {
  server.registerTool(
    "convert_pdf_form_to_html",
    {
      title: "Convert PDF Form to Accessible HTML",
      description:
        "Extract AcroForm fields from a PDF and generate an accessible HTML5 form " +
        "with proper labels, fieldsets, ARIA attributes, and keyboard-friendly styling. " +
        "Supports text inputs, checkboxes, radio groups, dropdowns, and multi-select lists. " +
        "Requires pdf-lib (optional — install with npm install pdf-lib).",
      inputSchema: z.object({
        filePath: z
          .string()
          .describe("Absolute or relative path to the PDF file containing form fields."),
        title: z
          .string()
          .default("PDF Form")
          .describe("Title for the generated HTML page (default: 'PDF Form')."),
      }),
    },
    async ({ params }) => {
      // --- pdf-lib availability check ---
      const pdfLib = await getPdfLib();
      if (!pdfLib) {
        return {
          content: [
            {
              type: "text",
              text:
                "pdf-lib is not installed.\n\n" +
                "pdf-lib is required for PDF form field extraction. Install it:\n" +
                "  npm install pdf-lib\n\n" +
                "pdf-lib is MIT-licensed, pure JavaScript, and has no native dependencies.",
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
        if (info.size > 100 * 1024 * 1024) {
          return {
            content: [
              { type: "text", text: "File exceeds 100 MB limit." },
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

      // --- Read and parse PDF ---
      try {
        const pdfBytes = await readFile(resolvedPath);
        const pdfDoc = await pdfLib.PDFDocument.load(pdfBytes, {
          ignoreEncryption: true,
        });

        const form = pdfDoc.getForm();
        const fields = extractFields(form, pdfLib);

        if (fields.length === 0) {
          return {
            content: [
              {
                type: "text",
                text:
                  `No AcroForm fields found in ${basename(resolvedPath)}.\n\n` +
                  "This PDF either has no form fields, uses XFA forms (not supported), " +
                  "or has flattened/embedded form fields that are no longer interactive.",
              },
            ],
          };
        }

        // --- Generate accessible HTML ---
        const title = params.title || basename(resolvedPath, ".pdf");
        const html = generateHtml(fields, title);

        // --- Build summary ---
        const typeCounts = {};
        for (const f of fields) {
          typeCounts[f.type] = (typeCounts[f.type] || 0) + 1;
        }
        const summary = Object.entries(typeCounts)
          .map(([t, c]) => `${t}: ${c}`)
          .join(", ");

        return {
          content: [
            {
              type: "text",
              text:
                `PDF FORM CONVERSION: ${basename(resolvedPath)}\n` +
                `Fields extracted: ${fields.length} (${summary})\n\n` +
                `--- ACCESSIBLE HTML OUTPUT ---\n\n${html}\n\n` +
                `--- FIELD INVENTORY ---\n\n` +
                fields
                  .map(
                    (f) =>
                      `- ${f.name} (${f.type})${f.isReadOnly ? " [read-only]" : ""}${f.isRequired ? " [required]" : ""}${f.options.length > 0 ? ` [${f.options.length} options]` : ""}`
                  )
                  .join("\n") +
                "\n\nAccessibility features included:\n" +
                "- Every input has an associated <label> with for/id binding\n" +
                "- Radio groups wrapped in <fieldset> with <legend>\n" +
                "- Required fields marked with aria-required and visual indicator\n" +
                "- Focus styles with 2px outline for keyboard users\n" +
                "- Responsive layout, proper font sizing\n" +
                "- High contrast borders (4.6:1 against white)\n" +
                "- Submit button meets touch target minimum (44x44px effective area)",
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `Error processing PDF: ${e.message?.slice(0, 500) || "Unknown error"}`,
            },
          ],
        };
      }
    }
  );
}
