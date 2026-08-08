import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';

export interface Analysis {
  evalCp: number | null;
  mate: number | null;
  pv: string[];
  depth: number;
}

@Injectable()
export class AppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppService.name);

  private stockfishProcess: ChildProcess;
  private engineReady = false;
  private currentResolve: ((value: string) => void) | null = null;
  private currentAnalyzeResolve: ((value: Analysis) => void) | null = null;
  private currentReject: ((err: Error) => void) | null = null;
  private timeoutId: NodeJS.Timeout | null = null;

  // Nilai terakhir yang diparsing dari baris "info" selama pencarian berjalan
  private lastEvalCp: number | null = null;
  private lastMate: number | null = null;
  private lastPv: string[] = [];
  private lastDepth = 0;

  onModuleInit() {
    // Gunakan stockfish-18-asm.js (pure JS, tidak butuh WASM threading)
    // sehingga bisa di-spawn sebagai child process via stdin/stdout
    const stockfishPath = path.join(
      path.dirname(require.resolve('stockfish')),
      'bin',
      'stockfish-18-asm.js',
    );

    this.logger.log(`Spawning Stockfish: ${stockfishPath}`);

    this.stockfishProcess = spawn('node', [stockfishPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.stockfishProcess.on('error', (err) => {
      this.logger.error(`Stockfish process error: ${err.message}`);
    });

    this.stockfishProcess.on('exit', (code) => {
      this.logger.warn(`Stockfish process exited with code ${code}`);
      this.engineReady = false;
    });

    // Baca output Stockfish baris per baris
    const rl = readline.createInterface({
      input: this.stockfishProcess.stdout as NodeJS.ReadableStream,
      crlfDelay: Infinity,
    });

    rl.on('line', (line: string) => {
      this.handleLine(line);
    });

    // Mulai protokol UCI
    this.send('uci');
  }

  private handleLine(line: string): void {
    line = line.trim();
    if (!line) return;

    if (line === 'uciok') {
      this.logger.log('UCI protocol initialized');
      // Kirim isready setelah uciok
      this.send('setoption name Skill Level value 20');
      this.send('setoption name Hash value 128');
      this.send('isready');
    } else if (line === 'readyok') {
      this.engineReady = true;
      this.logger.log('✅ Stockfish Engine siap! (Skill Level 20 | ASM.JS)');
    } else if (line.startsWith('info')) {
      this.parseInfoLine(line);
    } else if (line.startsWith('bestmove')) {
      const parts = line.split(' ');
      const move = parts[1];

      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }

      if (this.currentResolve) {
        if (move && move !== '(none)') {
          this.currentResolve(move);
        } else {
          this.currentReject?.(new Error('Engine returned no valid move'));
        }
        this.currentResolve = null;
      }

      if (this.currentAnalyzeResolve) {
        this.currentAnalyzeResolve({
          evalCp: this.lastEvalCp,
          mate: this.lastMate,
          pv: this.lastPv,
          depth: this.lastDepth,
        });
        this.currentAnalyzeResolve = null;
      }

      this.currentReject = null;
    }
  }

  /** Parsing baris `info depth N ... score cp X ... pv a2a3 ...` */
  private parseInfoLine(line: string): void {
    const scoreMatch = line.match(/score (cp|mate) (-?\d+)/);
    if (!scoreMatch) return;

    const kind = scoreMatch[1];
    const value = parseInt(scoreMatch[2], 10);

    const depthMatch = line.match(/\bdepth (\d+)/);
    if (depthMatch) {
      this.lastDepth = parseInt(depthMatch[1], 10);
    }

    if (kind === 'cp') {
      this.lastEvalCp = value;
      this.lastMate = null;
    } else {
      this.lastMate = value;
      this.lastEvalCp = null;
    }

    const pvMatch = line.match(/\bpv (.+)$/);
    this.lastPv = pvMatch ? pvMatch[1].trim().split(/\s+/) : [];
  }

  private send(command: string): void {
    if (this.stockfishProcess?.stdin?.writable) {
      this.stockfishProcess.stdin.write(command + '\n');
    }
  }

  onModuleDestroy() {
    this.send('quit');
    this.stockfishProcess?.kill();
  }

  isReady(): boolean {
    return this.engineReady;
  }

  private assertEngineIdle(): void {
    if (!this.engineReady) {
      throw new ServiceUnavailableException(
        'Stockfish engine masih dalam proses inisialisasi',
      );
    }

    if (this.currentResolve || this.currentAnalyzeResolve) {
      throw new HttpException(
        'Engine sedang menghitung langkah lain',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async getBestMove(fen: string, depth = 18): Promise<string> {
    this.assertEngineIdle();

    return new Promise((resolve, reject) => {
      this.currentResolve = resolve;
      this.currentReject = reject;

      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);

      // Timeout 30 detik agar tidak hang selamanya
      this.timeoutId = setTimeout(() => {
        if (this.currentResolve || this.currentAnalyzeResolve) {
          this.currentResolve = null;
          this.currentAnalyzeResolve = null;
          this.currentReject = null;
          this.send('stop');
          reject(new Error('Engine timeout setelah 30 detik'));
        }
      }, 30000);
    });
  }

  async analyze(fen: string, depth = 16): Promise<Analysis> {
    this.assertEngineIdle();

    return new Promise((resolve, reject) => {
      this.currentAnalyzeResolve = resolve;
      this.currentReject = reject;

      this.lastEvalCp = null;
      this.lastMate = null;
      this.lastPv = [];
      this.lastDepth = 0;

      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);

      this.timeoutId = setTimeout(() => {
        if (this.currentResolve || this.currentAnalyzeResolve) {
          this.currentResolve = null;
          this.currentAnalyzeResolve = null;
          this.currentReject = null;
          this.send('stop');
          reject(new Error('Engine timeout setelah 30 detik'));
        }
      }, 30000);
    });
  }
}
