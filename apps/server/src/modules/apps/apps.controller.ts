import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { ZodPipe } from '../../common/zod.pipe';
import { AppsService, toAppDto } from './apps.service';
import { createAppSchema, CreateAppInput, updateAppSchema, UpdateAppInput } from './apps.schemas';

@Controller('api/apps')
export class AppsController {
  constructor(private readonly apps: AppsService) {}

  @Get()
  async list() {
    return (await this.apps.list()).map(toAppDto);
  }

  @Post()
  async create(@Body(new ZodPipe(createAppSchema)) body: CreateAppInput) {
    return toAppDto(await this.apps.create(body));
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(updateAppSchema)) body: UpdateAppInput) {
    return toAppDto(await this.apps.update(id, body));
  }
}
