/**
 * 단말(ADB 기준)의 상세 정보 구조
 * - serial: 단말 고유 시리얼
 * - isUsimInserted: USIM 장착 여부
 * - simState: 원본 SIM 상태 문자열(gsm.sim.state)
 * - isActivated: 개통 여부(통신사 이름 기준의 간단한 추정)
 * - networkOperator: 통신사 이름(gsm.operator.alpha)
 */
export interface DeviceDetail {
  serial: string;
  isUsimInserted: boolean;
  simState: string;
  isActivated: boolean;
  networkOperator: string;
}
