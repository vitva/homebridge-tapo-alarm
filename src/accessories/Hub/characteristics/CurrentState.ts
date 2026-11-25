import {
  CharacteristicGetHandler,
  CharacteristicValue,
  Nullable
} from 'homebridge';

import { AccessoryThisType } from '..';
import { resolveAlarmState } from '../../../utils/alarmState';

const characteristic: {
  get: CharacteristicGetHandler;
} & AccessoryThisType = {
  get: async function (): Promise<Nullable<CharacteristicValue>> {
    const deviceInfo = await this.tpLink.getInfo();
    this.lastAlarmState = resolveAlarmState(
      deviceInfo.in_alarm,
      this.lastAlarmState
    );

    // Missing telemetry must not turn a previously detected alarm into clear.
    return this.lastAlarmState === true
      ? this.Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED
      : this.Characteristic.SecuritySystemCurrentState.DISARMED;
  }
};

export default characteristic;
