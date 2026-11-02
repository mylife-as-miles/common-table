import {useSyncExternalStore} from 'react';
import {getStorageStatus,subscribeStorageStatus} from './index';
export function useDeviceStorageStatus(){return useSyncExternalStore(subscribeStorageStatus,getStorageStatus,getStorageStatus);}
