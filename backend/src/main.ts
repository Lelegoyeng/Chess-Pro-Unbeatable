import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Allow semua origin agar frontend tetap jalan walau port vite berbeda
  // (mis. 3001) atau diakses via 127.0.0.1 / IP lain saat development.
  app.enableCors();
  await app.listen(5000);
  console.log('NestJS Backend is running on http://localhost:5000');
}
bootstrap();
