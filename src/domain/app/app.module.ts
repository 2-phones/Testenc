import { DevicesModule } from './../devices/devices.module';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [DevicesModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
