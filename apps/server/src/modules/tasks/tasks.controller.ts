import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ZodPipe } from '../../common/zod.pipe';
import { TaskmasterImportService } from './taskmaster-import.service';
import { TasksService, toTaskDto } from './tasks.service';
import {
  createTaskSchema,
  CreateTaskInput,
  importTaskmasterSchema,
  ImportTaskmasterInput,
  listTasksQuerySchema,
  ListTasksQuery,
  updateTaskSchema,
  UpdateTaskInput,
} from './tasks.schemas';

@Controller('api')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly importer: TaskmasterImportService,
  ) {}

  @Get('tasks')
  async list(@Query(new ZodPipe(listTasksQuerySchema)) query: ListTasksQuery) {
    return (await this.tasks.list(query)).map((t) => toTaskDto(t, t.app.code));
  }

  @Get('tasks/:id')
  async get(@Param('id') id: string) {
    const t = await this.tasks.get(id);
    return toTaskDto(t, t.app.code);
  }

  @Post('tasks')
  async create(@Body(new ZodPipe(createTaskSchema)) body: CreateTaskInput) {
    const { app, ...item } = body;
    const [t] = await this.tasks.createMany(app, [item]);
    return toTaskDto(t, t.app.code);
  }

  @Patch('tasks/:id')
  async update(@Param('id') id: string, @Body(new ZodPipe(updateTaskSchema)) body: UpdateTaskInput) {
    const t = await this.tasks.update(id, body);
    return toTaskDto(t, t.app.code);
  }

  @Post('import/taskmaster')
  importTaskmaster(@Body(new ZodPipe(importTaskmasterSchema)) body: ImportTaskmasterInput) {
    return this.importer.import(body.app, { path: body.path, dryRun: body.dryRun, update: body.update });
  }
}
