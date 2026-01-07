import { Body, Controller, Get, Post } from '@nestjs/common';
import { AdbService } from '../adb/adb.service';
import { DeviceDetail } from '../adb/interfaces/device-detail.interface';

@Controller('devices')
export class DevicesController {
  constructor(private readonly adbService: AdbService) {}

  /**
   * USB 장치 모니터링을 시작하고 단말 상태 목록을 반환합니다.
   */
  @Get()
  async getDevices(): Promise<DeviceDetail[]> {
    return this.adbService.device();
  }

  @Get('details')
  async getDevicesDetail() {
    const devices = await this.adbService.getDevicesWithDetails();
    console.log(devices);
    return devices;
  }

@Post('activationtime')
  async getActivationTime(@Body() body: { serial: string }) {
    const { serial } = body;
    const activationTime = await this.adbService.measureFullCycleTime(serial);
    console.log(activationTime);
    return activationTime;
  }
}
