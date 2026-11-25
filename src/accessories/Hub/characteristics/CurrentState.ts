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
    const deviceInfo = await this.tpLink.getInfo();
    if (typeof deviceInfo.in_alarm === 'boolean') {
      this.lastAlarmState = deviceInfo.in_alarm;
    }

    // Missing telemetry must not turn a previously detected alarm into clear.
    return this.lastAlarmState === true
      ? this.Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED
      : this.Characteristic.SecuritySystemCurrentState.DISARMED;
  }
};

export default characteristic;
