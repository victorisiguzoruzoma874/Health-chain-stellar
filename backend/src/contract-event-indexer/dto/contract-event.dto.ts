import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

import { ContractDomain } from '../entities/contract-event.entity';

export class QueryContractEventsDto {
  @IsOptional()
  @IsEnum(ContractDomain)
  domain?: ContractDomain;

  @IsOptional()
  @IsString()
  eventType?: string;

  @IsOptional()
  @IsString()
  entityRef?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  pageSize?: number = 25;
}

export class ReplayFromLedgerDto {
  @IsInt()
  @Min(0)
  @Type(() => Number)
  fromLedger: number;

  @IsOptional()
  @IsEnum(ContractDomain)
  domain?: ContractDomain;
}

export class IngestEventDto {
  @IsEnum(ContractDomain)
  domain: ContractDomain;

  @IsString()
  eventType: string;

  @IsInt()
  @Min(0)
  @Type(() => Number)
  ledgerSequence: number;

  @IsOptional()
  @IsString()
  txHash?: string;

  @IsOptional()
  @IsString()
  contractRef?: string;

  payload: Record<string, unknown>;

  @IsOptional()
  @IsString()
  entityRef?: string;
}
