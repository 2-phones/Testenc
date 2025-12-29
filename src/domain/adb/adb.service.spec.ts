import { Test, TestingModule } from '@nestjs/testing';
import { AdbService } from './adb.service';

describe('AdbService', () => {
  let service: AdbService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdbService],
    }).compile();

    service = module.get<AdbService>(AdbService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
