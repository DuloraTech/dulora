import Koa from 'koa';
import { Body, Ctx, Get, JsonController, Post } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { HealthService } from '../modules/health/application/health.service';
import { validateDto } from '../shared/validate';
import {
  HealthConfigDto,
  HealthDailyQueryDto,
  HealthLoginCancelDto,
  HealthSleepQueryDto,
  HealthSyncDto,
  HealthWeightQueryDto,
} from './health-data.dtos';

/** 健康数据模块（小米运动健康同步）。/api/health 为探活端点，故用 /health-data 前缀 */
@Service()
@JsonController('/health-data')
export class HealthDataController {
  @Inject(() => HealthService)
  private health!: HealthService;

  @Get('/status')
  status() {
    return this.health.status();
  }

  @Get('/daily')
  async daily(@Ctx() ctx: Koa.Context) {
    const q = ctx.query;
    const dto = await validateDto(HealthDailyQueryDto, {
      ...(q.from !== undefined ? { from: Array.isArray(q.from) ? q.from[0] : q.from } : {}),
      ...(q.to !== undefined ? { to: Array.isArray(q.to) ? q.to[0] : q.to } : {}),
    });
    return this.health.daily(dto.from, dto.to);
  }

  @Get('/sleep')
  async sleep(@Ctx() ctx: Koa.Context) {
    const raw = ctx.query.date;
    const dto = await validateDto(HealthSleepQueryDto, {
      date: Array.isArray(raw) ? raw[0] : raw,
    });
    return this.health.sleep(dto.date);
  }

  @Get('/weight')
  async weight(@Ctx() ctx: Koa.Context) {
    const raw = ctx.query.days;
    const dto = await validateDto(HealthWeightQueryDto, {
      ...(raw !== undefined ? { days: Array.isArray(raw) ? raw[0] : raw } : {}),
    });
    return this.health.weight(dto.days ?? 90);
  }

  @Post('/sync')
  async sync(@Body() body: unknown) {
    const dto = await validateDto(HealthSyncDto, body ?? {});
    return this.health.sync({ days: dto.days });
  }

  @Post('/login/start')
  loginStart() {
    return this.health.loginStart();
  }

  @Get('/login/status')
  loginStatus(@Ctx() ctx: Koa.Context) {
    const raw = ctx.query.session;
    const sessionId = Array.isArray(raw) ? raw[0] : raw;
    return this.health.loginStatus(sessionId ?? '');
  }

  @Post('/login/cancel')
  async loginCancel(@Body() body: unknown) {
    const dto = await validateDto(HealthLoginCancelDto, body);
    return this.health.loginCancel(dto.sessionId);
  }

  @Post('/disconnect')
  disconnect() {
    return this.health.disconnect();
  }

  @Get('/config')
  getConfig() {
    return this.health.getConfig();
  }

  @Post('/config')
  async updateConfig(@Body() body: unknown) {
    const dto = await validateDto(HealthConfigDto, body);
    return this.health.updateConfig(dto);
  }
}