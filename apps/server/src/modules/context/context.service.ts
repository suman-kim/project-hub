import { Inject, Injectable } from '@nestjs/common';
import { HUB_CONFIG, HubConfig } from '../../config/hub-config';
import { App } from '../apps/app.entity';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { MineService } from '../mine/mine.service';
import { Task } from '../tasks/task.entity';
import { TasksService } from '../tasks/tasks.service';
import { buildContext, ContextInput } from './build-context';

@Injectable()
export class ContextService {
  constructor(
    @Inject(HUB_CONFIG) private readonly config: HubConfig,
    private readonly tasks: TasksService,
    private readonly knowledge: KnowledgeService,
    private readonly mine: MineService,
  ) {}

  async forSession(args: {
    cwd: string;
    source: string;
    app: App | null;
    task: Task | null;
    unknownTaskId: string | null;
    guard?: ContextInput['guard'];
  }): Promise<string> {
    const { app, task } = args;
    if (!app) {
      return buildContext({ ...args, app: null, task: null, openTasks: [], mistakes: [] }, this.config.contextMaxChars);
    }
    const [specs, openTasks, mistakes, myDocs] = await Promise.all([
      task ? this.knowledge.specsForTask(task.id, task.ideaId) : Promise.resolve([]),
      this.tasks.openForContext(app.id, task?.id ?? null, 5),
      this.knowledge.activeMistakes(app.id, 5),
      this.mine.contextDocs(app.id, 8),
    ]);
    return buildContext(
      {
        cwd: args.cwd,
        source: args.source,
        app,
        unknownTaskId: args.unknownTaskId,
        task: task ? { id: task.id, title: task.title, status: task.status, specs } : null,
        openTasks,
        mistakes,
        myDocs,
        guard: args.guard,
      },
      this.config.contextMaxChars,
    );
  }
}
