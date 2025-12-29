import { Module } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';
import { AdbService } from '../adb/adb.service';

@Module({
  providers: [DevicesService, AdbService],
  controllers: [DevicesController],
  exports: [AdbService],
})
export class DevicesModule {}
