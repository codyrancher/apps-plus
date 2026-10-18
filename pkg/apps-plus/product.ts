import { IPlugin } from '@shell/core/types';
import { PRODUCT_NAME, APP, APP_INSTANCE } from './config/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function init($plugin: IPlugin, store: any) {
  const { basicType, configureType, weightType } = $plugin.DSL(store, PRODUCT_NAME);

  configureType(APP, {
    isCreatable:              true,
    isEditable:               true,
    isRemovable:              true,
    showState:                false,
    showAge:                  false,
    showListMasthead:         false,
    canYaml:                  true,
    listCreateButtonLabelKey: 'appsPlus.action.createApp',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  configureType(APP_INSTANCE, {
    isCreatable: true,
    isEditable:  true,
    isRemovable: true,
    showState:   true,
    showAge:     true,
    canYaml:     true,
  });

  basicType([APP]);
  weightType(APP, -1, true);
}
