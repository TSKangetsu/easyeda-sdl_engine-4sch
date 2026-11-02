import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

/**
 * EasyEDA Pro Desktop CLI Bridge Client
 */
export class LcedaBridge {
  constructor(options = {}) {
    this.cliPath = options.cliPath || 'lceda-pro';
  }

  /**
   * Run raw CLI command with arguments
   */
  async runRaw(args) {
    try {
      // On Windows, GUI executable output might need cmd wrapper or direct execFile
      const { stdout } = await execFileAsync('cmd.exe', ['/c', this.cliPath, ...args], {
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf-8'
      });
      const trimmed = stdout.trim();
      if (!trimmed) {
        return { ok: false, error: 'Empty output from lceda-pro' };
      }
      return JSON.parse(trimmed);
    } catch (err) {
      if (err.stdout) {
        try {
          return JSON.parse(err.stdout.trim());
        } catch (_) {}
      }
      throw new Error(`lceda-pro command failed: ${err.message}`);
    }
  }

  /**
   * Check connection to EasyEDA Pro
   */
  async doctor() {
    return this.runRaw(['doctor']);
  }

  /**
   * List all running sessions
   */
  async listSessions() {
    const res = await this.runRaw(['session', 'list']);
    if (res.ok && Array.isArray(res.value)) {
      return res.value;
    }
    return [];
  }

  /**
   * Get first alive session
   */
  async getActiveSession() {
    const sessions = await this.listSessions();
    const alive = sessions.find(s => s.status === 'alive');
    if (!alive) {
      throw new Error('No alive EasyEDA session found. Please open an editor window or project.');
    }
    return alive;
  }

  /**
   * Invoke JavaScript snippet in session
   * Writes code to a temporary file to avoid command-line quoting issues
   */
  async invoke(sessionId, code, args = {}) {
    const tempFile = path.join(os.tmpdir(), `lceda_invoke_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.js`);
    try {
      fs.writeFileSync(tempFile, code, 'utf-8');
      const cliArgs = [
        'invoke',
        '--session', String(sessionId),
        '--code-file', tempFile
      ];
      if (args && Object.keys(args).length > 0) {
        cliArgs.push('--args', JSON.stringify(args));
      }
      return await this.runRaw(cliArgs);
    } finally {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch (_) {}
    }
  }
}

