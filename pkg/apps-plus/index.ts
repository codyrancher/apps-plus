import { importTypes } from '@rancher/auto-import';
import { IPlugin } from '@shell/core/types';
import { ensureService } from './service';

// The entry point. The dashboard calls this once, with a plugin object to register things on.
export default function(plugin: IPlugin): void {
  // Picks up models/, list/, edit/, detail/ and l10n/ by filename. Every page this extension
  // has is one of those, which is why it registers no routes of its own: the shell's generic
  // `c-cluster-product-resource*` routes already render whatever these folders provide.
  importTypes(plugin);

  plugin.metadata = require('./package.json');

  plugin.addProduct(require('./product'));

  /**
   * The half of this extension that is not a browser.
   *
   * Deleting an Installation puts the `appsplus.io/cleanup` finalizer on it, and something then
   * has to tear down what it deployed and take that finalizer off - otherwise the object sits
   * Terminating for ever and its row never leaves any list that reads Installations. That work
   * used to live only in a loop inside the browser's own delete, so a closed tab or a teardown
   * slower than two minutes left a permanent tombstone. It belongs to this extension because the
   * finalizer does: whoever puts one on owns taking it off.
   *
   * Create-if-missing and quiet, for the same reason every other ensure of this shape is: this
   * runs on every load for every user, most of whom cannot write to that namespace and none of
   * whom asked for it. Bootstrapping still needs a browser once - something has to create the
   * Deployment, and this bundle is the only thing that knows what it should contain - but after
   * that nobody has to be watching, which was the whole point.
   */
  ensureService().catch(() => {});
}

