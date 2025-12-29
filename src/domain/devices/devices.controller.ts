import { AdbService } from './../adb/adb.service';
import { Controller, Get } from '@nestjs/common';

@Controller('devices')
export class DevicesController {
  constructor(private readonly adbService: AdbService) {}

  @Get()
  async devicesGet() {
    const usb = await this.adbService.device();
    return usb;
  }
}
