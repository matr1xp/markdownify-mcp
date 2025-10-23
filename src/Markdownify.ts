import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { expandHome } from "./utils.js";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type MarkdownResult = {
  path: string;
  text: string;
};

export class Markdownify {
  private static async _markitdown(
    filePath: string,
    projectRoot: string,
    uvPath: string,
  ): Promise<string> {
    // Expand tilde in uvPath if present
    const expandedUvPath = expandHome(uvPath);

    // First try using uv run to execute markitdown directly (works if uv is installed)
    try {
      const { stdout, stderr } = await execFileAsync(expandedUvPath, [
        "run",
        "--with",
        "markitdown",
        "markitdown",
        filePath,
      ], {
        env: {
          ...process.env,
          PATH: `${process.env.PATH}:${path.dirname(expandedUvPath)}`,
        }
      });

      // uv sometimes outputs informational messages to stderr, ignore common ones
      if (stderr && !stderr.includes("Reading inline script") &&
          !stderr.includes("Resolved") && !stderr.includes("Downloading") &&
          !stderr.includes("Installed")) {
        console.error(`[markdownify] Warning from uv: ${stderr}`);
      }

      return stdout;
    } catch (error: any) {
      // If uv run fails, try the local venv installation as fallback
      const venvPath = path.join(projectRoot, ".venv");
      const markitdownPath = path.join(
        venvPath,
        process.platform === "win32" ? "Scripts" : "bin",
        `markitdown${process.platform === "win32" ? ".exe" : ""}`,
      );

      if (!fs.existsSync(markitdownPath)) {
        throw new Error(
          `markitdown executable not found.\n\n` +
          `Tried:\n` +
          `1. uv run --with markitdown (failed: ${error.message})\n` +
          `2. Local venv at ${markitdownPath} (not found)\n\n` +
          `Solutions:\n` +
          `- Ensure uv is installed: curl -LsSf https://astral.sh/uv/install.sh | sh\n` +
          `- Ensure uv is in PATH: ${expandedUvPath}\n` +
          `- Or run 'npm run setup' to create local venv\n`
        );
      }

      const { stdout, stderr } = await execFileAsync(expandedUvPath, [
        "run",
        markitdownPath,
        filePath,
      ]);

      if (stderr) {
        throw new Error(`Error executing command: ${stderr}`);
      }

      return stdout;
    }
  }

  private static async saveToTempFile(
    content: string | Buffer,
    suggestedExtension?: string | null,
  ): Promise<string> {
    let outputExtension = "md";
    if (suggestedExtension != null) {
      outputExtension = suggestedExtension;
    }

    const tempOutputPath = path.join(
      os.tmpdir(),
      `markdown_output_${Date.now()}.${outputExtension}`,
    );
    fs.writeFileSync(tempOutputPath, content);
    return tempOutputPath;
  }

  private static normalizePath(p: string): string {
    return path.normalize(p);
  }

  static async toMarkdown({
    filePath,
    url,
    projectRoot = path.resolve(__dirname, ".."),
    uvPath = "~/.local/bin/uv",
  }: {
    filePath?: string;
    url?: string;
    projectRoot?: string;
    uvPath?: string;
  }): Promise<MarkdownResult> {
    try {
      let inputPath: string;
      let isTemporary = false;

      if (url) {
        const response = await fetch(url);

        let extension = null;

        if (url.endsWith(".pdf")) {
          extension = "pdf";
        }

        const arrayBuffer = await response.arrayBuffer();
        const content = Buffer.from(arrayBuffer);

        inputPath = await this.saveToTempFile(content, extension);
        isTemporary = true;
      } else if (filePath) {
        inputPath = filePath;
      } else {
        throw new Error("Either filePath or url must be provided");
      }

      const text = await this._markitdown(inputPath, projectRoot, uvPath);
      const outputPath = await this.saveToTempFile(text);

      if (isTemporary) {
        fs.unlinkSync(inputPath);
      }

      return { path: outputPath, text };
    } catch (e: unknown) {
      if (e instanceof Error) {
        throw new Error(`Error processing to Markdown: ${e.message}`);
      } else {
        throw new Error("Error processing to Markdown: Unknown error occurred");
      }
    }
  }

  static async get({
    filePath,
  }: {
    filePath: string;
  }): Promise<MarkdownResult> {
    // Check file type is *.md or *.markdown
    const normPath = this.normalizePath(path.resolve(expandHome(filePath)));
    const markdownExt = [".md", ".markdown"];
    if (!markdownExt.includes(path.extname(normPath))) {
      throw new Error("Required file is not a Markdown file.");
    }

    if (process.env?.MD_SHARE_DIR) {
      const allowedShareDir = this.normalizePath(
        path.resolve(expandHome(process.env.MD_SHARE_DIR)),
      );
      if (!normPath.startsWith(allowedShareDir)) {
        throw new Error(`Only files in ${allowedShareDir} are allowed.`);
      }
    }

    if (!fs.existsSync(filePath)) {
      throw new Error("File does not exist");
    }

    const text = await fs.promises.readFile(filePath, "utf-8");

    return {
      path: filePath,
      text: text,
    };
  }
}
