import SteveModel from '@shell/plugins/steve/steve-class';
import {
  APP_INSTANCE, PRODUCT_NAME, BLANK_CLUSTER, CREATE_ROUTE, APP_QUERY
} from '../config/types';

/**
 * An App is the definition - a set of YAML templates and the values they render with. It
 * deploys nothing by itself; an AppInstance of it is what reaches a cluster.
 */
export default class App extends SteveModel {
  get nameDisplay() {
    return this.spec?.displayName || this.metadata?.name;
  }

  get templates() {
    return this.spec?.templates || [];
  }

  get templateCount() {
    return this.templates.length;
  }

  /**
   * The instances of this app. Reads what is already in the store rather than fetching:
   * every page that shows this has loaded AppInstances itself, and a getter that fetched
   * would run once per row.
   */
  get instances() {
    try {
      return this.$rootGetters['management/all'](APP_INSTANCE)
        .filter((instance) => instance.spec?.app === this.metadata?.name);
    } catch {
      return [];
    }
  }

  get createInstanceLocation() {
    return {
      name:   CREATE_ROUTE,
      params: {
        product: PRODUCT_NAME, cluster: BLANK_CLUSTER, resource: APP_INSTANCE
      },
      query: { [APP_QUERY]: this.metadata?.name },
    };
  }
}
