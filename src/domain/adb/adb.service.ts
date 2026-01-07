import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as usbDetect from 'usb-detection';
import * as adb from 'adbkit';
import { DeviceDetail } from './interfaces/device-detail.interface';

@Injectable()
export class AdbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdbService.name);

  /**
   * ADB 서버와 통신하기 위한 클라이언트 인스턴스
   */
  private readonly adbClient = adb.createClient();

  /**
   * USB 모니터링이 이미 시작되었는지 여부
   * - 중복 startMonitoring 호출 방지
   */
  private monitoringStarted = false;

  /**
   * Nest 모듈 초기화 시점에 호출
   * - 서버가 기동되면 자동으로 USB 모니터링을 시작
   */
  onModuleInit() {
    this.startMonitoring();
  }

  /**
   * Nest 모듈 종료 시점에 호출
   * - 서버가 내려갈 때 USB 모니터링 중단
   */
  onModuleDestroy() {
    usbDetect.stopMonitoring();
  }

  /**
   * USB 장치 연결/해제 이벤트를 감시하는 모니터링을 시작
   * - 실제 ADB 상태 조회는 별도 메서드에서 수행
   */
  private startMonitoring(): void {
    if (this.monitoringStarted) return;

    // USB 이벤트 감시 시작
    usbDetect.startMonitoring();

    // USB 장치가 연결되었을 때 (OS 인식 완료 후 ADB 상태를 조회하는 것이 정확)
    usbDetect.on('add', (device) => {
      this.logger.log(`USB 연결됨: ${device.deviceName}`);
      // 필요하다면 이 시점에서 setTimeout 등을 사용해
      // ADB 상태 재조회 트리거를 걸 수 있음
    });

    // USB 장치가 제거되었을 때
    usbDetect.on('remove', (device) => {
      this.logger.warn(`USB 제거됨: ${device.deviceName}`);
    });

    this.monitoringStarted = true;
    this.logger.log('USB 모니터링 시스템 활성화');
  }

  /**
   * 현재 ADB에 연결된 모든 단말의
   * - USIM 장착 여부
   * - 개통(통신사 등록) 여부
   * 를 조회해서 반환
   *
   * 주의:
   * - 개통 여부는 "통신사 이름이 정상적으로 조회된다"는 기준의 단순 추정이므로
   *   100% 정확한 통신사/회선 레벨의 개통 판정은 아님
   */
  async getDevicesWithDetails(): Promise<DeviceDetail[]> {
    try {
      // ADB에 연결되어 있는 모든 디바이스 목록 조회
      const devices = await this.adbClient.listDevices();

      // 각 디바이스별로 SIM 상태/통신사 정보를 조회
      return await Promise.all(
        devices.map(async (d) => {
          // 예: READY,ABSENT / READY / ABSENT 등 단일 또는 콤마 구분 형식
          const simStateRaw = await this.getProp(d.id, 'gsm.sim.state');
          // 예: SKTelecom / KT / LGU+ / UNKNOWN / (빈 값)
          const operatorRaw = await this.getProp(d.id, 'gsm.operator.alpha');

          const simStates = simStateRaw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

          const operator = operatorRaw.trim();
          const normalizedOperator = operator.toLowerCase();

          // USIM이 "READY" 상태인 슬롯이 하나라도 있으면 장착된 것으로 간주
          const isUsimInserted = simStates.some(
            (s) => s.toUpperCase() === 'READY',
          );

          // 통신사 이름이 비어 있지 않고, UNKNOWN/none 이 아닌 경우를 "개통됨"으로 간주
          const isActivated =
            !!operator &&
            normalizedOperator !== 'unknown' &&
            normalizedOperator !== 'none';

          return {
            serial: d.id,
            isUsimInserted,
            simState: simStateRaw,
            isActivated,
            networkOperator: operator || 'N/A',
          };
        }),
      );
    } catch (error) {
      // ADB 서버 다운, 연결 불가 등 전체 조회 실패 시
      this.logger.error(
        'ADB 장치 정보 조회 실패',
        error instanceof Error ? error.stack : String(error),
      );
      // 호출 측에서 "에러"와 "장치가 없음"을 구분해야 한다면
      // throw 를 던지고 컨트롤러에서 처리하도록 변경할 수도 있음
      return [];
    }
  }

  /**
   * ADB를 통해 `getprop <key>` 값을 읽어오는 헬퍼 메서드
   * - 에러 시 빈 문자열을 반환하고, 경고 로그를 남김
   */
  private async getProp(serial: string, key: string): Promise<string> {
    try {
      const output = await this.adbClient.shell(serial, `getprop ${key}`);
      const buf = await adb.util.readAll(output);
      return buf.toString().trim();
    } catch (error) {
      this.logger.warn(
        `getprop 실패 - serial=${serial}, key=${key}`,
        error instanceof Error ? error.stack : String(error),
      );
      return '';
    }
  }

  /**
   * 기존 컨트롤러에서 사용하던 엔드포인트용 메서드
   * - 현재는 단말 상세 목록 전체를 그대로 반환
   * - 필요 시 여기서 JSON 스키마를 한 번 더 래핑해서
   *   { success, devices } 형태로 내려줄 수도 있음
   */
  async device(): Promise<DeviceDetail[]> {
    return this.getDevicesWithDetails();
  }
}
