import {
  CharacteristicGetHandler,
  CharacteristicValue,
  Nullable
} from 'homebridge';

import { AccessoryThisType } from '..';

const characteristic: {
  get: CharacteristicGetHandler;
} & AccessoryThisType = {
  get: async function (): Promise<Nullable<CharacteristicValue>> {
    // The H100's armed/disarmed mode is managed by the Tapo app.
    // in_alarm is an alarm-event flag, not the armed state.
    return this.Characteristic.SecuritySystemTargetState.DISARM;
  }
};

export default characteristic;
