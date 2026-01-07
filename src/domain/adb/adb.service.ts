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

          const operator = operatorRaw.trim().replace(/,$/, '');
          const normalizedOperator = operator.toLowerCase();
          // USIM이 "READY" 상태인 슬롯이 하나라도 있으면 장착된 것으로 간주
          const isUsimInserted = simStates.some((s) =>
            ['READY', 'LOADED', 'PIN_REQUIRED', 'PUK_REQUIRED'].includes(s),
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
   * 특정 단말의 USIM 개통 완료까지 걸린 시간을 측정합니다.
   *
   * - 이 메서드가 호출된 시점을 "개통 측정 시작 시점"으로 간주합니다.
   * - 주기적으로 `gsm.sim.state`, `gsm.operator.alpha` 를 조회하면서
   *   개통 완료 조건을 만족할 때까지 대기합니다.
   *
   * 개통 완료 조건(단말 관점):
   * - 통신사 이름이 비어 있지 않고, UNKNOWN/none 이 아닌 경우
   */
  async measureActivationTime(
    serial: string,
    timeoutMs = 5 * 60 * 1000,
    intervalMs = 2000,
  ): Promise<{
    success: boolean;
    reason?: string;
    elapsedMs: number | null;
    startAt: number;
    endAt: number | null;
    snapshots: Array<{
      timestamp: number;
      simState: string;
      operator: string;
    }>;
  }> {
    const startAt = Date.now();
    const deadline = startAt + timeoutMs;
    const snapshots: Array<{
      timestamp: number;
      simState: string;
      operator: string;
    }> = [];

    // 1. 현재 연결된 디바이스 목록에 serial 이 존재하는지 먼저 확인
    const devices = await this.adbClient.listDevices();
    const exists = devices.some((d) => d.id === serial);

    if (!exists) {
      const reason = `시리얼 ${serial} 인 장치가 ADB에 연결되어 있지 않습니다.`;
      this.logger.warn(`개통 측정 시작 실패: ${reason}`);

      return {
        success: false,
        reason,
        elapsedMs: null,
        startAt,
        endAt: null,
        snapshots,
      };
    }

    // polling loop
    while (Date.now() < deadline) {
      const now = Date.now();

      // 루프 중에도 장치가 사라질 수 있으므로 매번 존재 여부 확인
      const loopDevices = await this.adbClient.listDevices();
      const loopExists = loopDevices.some((d) => d.id === serial);

      if (!loopExists) {
        const reason = `개통 측정 중 장치(${serial})가 ADB에서 사라졌습니다.`;
        this.logger.warn(reason);

        return {
          success: false,
          reason,
          elapsedMs: null,
          startAt,
          endAt: null,
          snapshots,
        };
      }

      const simStateRaw = await this.getProp(serial, 'gsm.sim.state');
      const operatorRaw = await this.getProp(serial, 'gsm.operator.alpha');
      const operator = operatorRaw.trim().replace(/,$/, '');
      const normalizedOperator = operator.toLowerCase();

      snapshots.push({
        timestamp: now,
        simState: simStateRaw,
        operator,
      });

      const isActivated =
        !!operator &&
        normalizedOperator !== 'unknown' &&
        normalizedOperator !== 'none';

      if (isActivated) {
        const endAt = now;
        const elapsedMs = endAt - startAt;
        this.logger.log(
          `단말(${serial}) 개통 완료로 판단됨 - 경과 시간: ${elapsedMs}ms`,
        );

        return {
          success: true,
          elapsedMs,
          startAt,
          endAt,
          snapshots,
        };
      }

      // 아직 개통되지 않은 경우 interval 만큼 대기
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    // 타임아웃
    const reason = `단말(${serial}) 개통 측정 타임아웃 초과 - timeoutMs=${timeoutMs}`;
    this.logger.warn(reason);

    return {
      success: false,
      reason,
      elapsedMs: null,
      startAt,
      endAt: null,
      snapshots,
    };
  }

  async measureFullCycleTime(serial: string, timeoutMs = 5 * 60 * 1000) {
  const startAt = Date.now();
  const deadline = startAt + timeoutMs;
  
  let step: 'START' | 'FIRST_ATTACH' | 'DETACHED' | 'FINAL_ATTACH' = 'START';
  let firstTime = 0;
  let detachTime = 0;
  let finalTime = 0;

  this.logger.log(`[${serial}] 풀 사이클 개통 측정 시작...`);

  while (Date.now() < deadline) {
    const devices = await this.getDevicesWithDetails();
    const device = devices.find(d => d.serial === serial);

    if (!device) {
      // 재부팅 등으로 잠시 사라질 수 있으므로 바로 에러를 내지 않고 대기합니다.
      await new Promise(res => setTimeout(res, 2000));
      continue;
    }

    // STEP 1 & 2: 1차 망 등록 감지
    if (step === 'START' && device.isActivated) {
      step = 'FIRST_ATTACH';
      firstTime = Date.now();
      this.logger.log(`[${serial}] 1차 망 등록 감지...`);
    }

    // STEP 3: 망 이탈 감지 (1차 등록 후 다시 활성화가 꺼짐)
    if (step === 'FIRST_ATTACH' && !device.isActivated) {
      step = 'DETACHED';
      detachTime = Date.now();
      this.logger.warn(`[${serial}] 망 이탈 감지 (재인증 진행 중)`);
    }

    // STEP 4: 최종 망 등록 감지 (이탈 후 다시 활성화됨)
    if (step === 'DETACHED' && device.isActivated) {
      step = 'FINAL_ATTACH';
      finalTime = Date.now();
      
      const totalElapsed = (finalTime - startAt) / 1000;
      this.logger.log(`[${serial}] 최종 개통 완료! 총 소요시간: ${totalElapsed}초`);

      return {
        success: true,
        totalElapsedSeconds: totalElapsed,
        firstAttachElapsed: (firstTime - startAt) / 1000,
        reattachElapsed: (finalTime - detachTime) / 1000,
        steps: { firstTime, detachTime, finalTime }
      };
    }

    await new Promise(res => setTimeout(res, 1500)); // 1.5초 간격 폴링
  }

  return { success: false, reason: 'Timeout' };
}

  async trackFullActivationCycle(serial: string) {
    const log = (msg: string): void => this.logger.log(`[${serial}] ${msg}`);
    let step = 1;
    const startTime = Date.now();
    let firstAttachedTime = 0;
    let detachedTime = 0;
    let finalAttachedTime = 0;

    log('전체 개통 사이클 모니터링 시작...');

    const monitor = setInterval(async () => {
      const details = await this.getDevicesWithDetails();
      const device = details.find((d) => d.serial === serial);

      if (!device) {
        log('장치를 찾을 수 없어 모니터링을 종료합니다.');
        clearInterval(monitor);
        return;
      }

      // STEP 1: 유심 인식 확인 (READY/LOADED)
      if (step === 1 && device.isUsimInserted) {
        log(`STEP 1 완료: 유심 인식됨 (${(Date.now() - startTime) / 1000}초)`);
        step = 2;
      }

      // STEP 2: 1차 망 등록 확인
      if (step === 2 && device.isActivated) {
        firstAttachedTime = Date.now();
        log(
          `STEP 2 완료: 1차 망 등록됨 (누적 ${
            (firstAttachedTime - startTime) / 1000
          }초)`,
        );
        step = 3;
      }

      // STEP 3: 망 빠짐 감지 (Activation이 다시 해제되거나 통신사가 사라짐)
      if (step === 3 && !device.isActivated) {
        detachedTime = Date.now();
        log(`STEP 3 확인: 망 해제(재인증/재부팅 중) 발생`);
        step = 4;
      }

      // STEP 4: 최종 망 등록 확인
      if (step === 4 && device.isActivated) {
        finalAttachedTime = Date.now();
        log(`STEP 4 완료: 최종 망 등록 완료!`);

        const totalDuration = (finalAttachedTime - startTime) / 1000;
        const reattachDuration = (finalAttachedTime - detachedTime) / 1000;

        log(
          `[최종 결과] 총 소요시간: ${totalDuration}초, 재등록 소요시간: ${reattachDuration}초`,
        );

        clearInterval(monitor); // 측정 종료
      }

      // 타임아웃 방지 (예: 5분 이상 걸리면 중단)
      if (Date.now() - startTime > 300000) {
        log('측정 실패: 5분 타임아웃');
        clearInterval(monitor);
      }
    }, 1000);
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
    const devices = await this.getDevicesWithDetails();
    console.log(`devices : ${JSON.stringify(devices)}`);
    return devices;
  }
}
