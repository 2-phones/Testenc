import { Injectable, Logger } from '@nestjs/common';
import * as adb from 'adbkit';
import * as usbDetect from 'usb-detection';

@Injectable()
export class AdbService {
  private readonly logger = new Logger(AdbService.name);

  async device(): Promise<string> {
    usbDetect.startMonitoring();

    usbDetect.on('add', (connect) => {
      this.logger.log(`연결 됨 : ${connect.deviceName}`);
      console.log(`연결 됨 : ${connect.deviceName}`);
      return;
    });

    usbDetect.on('remove', (device) => {
      this.logger.warn(`USB 장치 제거됨: ${device.deviceName}`);
    });
    return 'hello!!!';
  }
}
