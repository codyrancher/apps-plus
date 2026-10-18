import { importTypes } from '@rancher/auto-import';
import { IPlugin } from '@shell/core/types';
import { ensureService } from './service';

export default function(plugin: IPlugin): void {
  importTypes(plugin);

  plugin.metadata = require('./package.json');

  plugin.addProduct(require('./product'));

  ensureService().catch(() => {});
}
