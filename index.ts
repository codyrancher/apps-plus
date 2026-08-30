import { importTypes } from '@rancher/auto-import';
import { IPlugin } from '@shell/core/types';

// The entry point. The dashboard calls this once, with a plugin object to register things on.
export default function(plugin: IPlugin): void {
  // Picks up models/, list/, edit/, detail/ and l10n/ by filename. Every page this extension
  // has is one of those, which is why it registers no routes of its own: the shell's generic
  // `c-cluster-product-resource*` routes already render whatever these folders provide.
  importTypes(plugin);

  plugin.metadata = require('./package.json');

  plugin.addProduct(require('./product'));
}
