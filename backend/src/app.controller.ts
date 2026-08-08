import { Controller, Post, Get, Body } from '@nestjs/common';
import { AppService } from './app.service';

class BestMoveDto {
  fen: string;
  depth?: number;
}

@Controller('bestmove')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  checkHealth() {
    return { status: this.appService.isReady() ? 'ok' : 'initializing' };
  }

  @Post()
  async getBestMove(@Body() body: BestMoveDto) {
    const move = await this.appService.getBestMove(body.fen, body.depth);
    return { bestMove: move };
  }

  @Post('analyze')
  async analyze(@Body() body: BestMoveDto) {
    return this.appService.analyze(body.fen, body.depth ?? 16);
  }
}
