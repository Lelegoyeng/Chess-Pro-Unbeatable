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

@Injectable()
export class AppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppService.name);

  private stockfishProcess: ChildProcess;
  private engineReady = false;
  private currentResolve: ((value: string) => void) | null = null;
  private currentReject: ((err: Error) => void) | null = null;
  private timeoutId: NodeJS.Timeout | null = null;

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
          this.currentReject = null;
        }
      }
    });

    // Mulai protokol UCI
    this.send('uci');
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

  async getBestMove(fen: string, depth = 18): Promise<string> {
    if (!this.engineReady) {
      throw new ServiceUnavailableException(
        'Stockfish engine masih dalam proses inisialisasi',
      );
    }

    if (this.currentResolve) {
      throw new HttpException(
        'Engine sedang menghitung langkah lain',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return new Promise((resolve, reject) => {
      this.currentResolve = resolve;
      this.currentReject = reject;

      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);

      // Timeout 30 detik agar tidak hang selamanya
      this.timeoutId = setTimeout(() => {
        if (this.currentResolve) {
          this.currentResolve = null;
          this.currentReject = null;
          this.send('stop');
          reject(new Error('Engine timeout setelah 30 detik'));
        }
      }, 30000);
    });
  }
}
