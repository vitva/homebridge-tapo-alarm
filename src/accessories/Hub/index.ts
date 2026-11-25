import {
  PlatformAccessory,
  Logger,
  Characteristic as CharInstance
} from 'homebridge';

import DeviceInfo from '../../api/@types/DeviceInfo';
import TapoAccessory from '../../@types/TapoAccessory';
import Context from '../../@types/Context';
import TPLink from '../../api/TPLink';
import Platform from '../../platform';
import { resolveAlarmState } from '../../utils/alarmState';

import CurrentState from './characteristics/CurrentState';
import TargetState from './characteristics/TargetState';

export type AccessoryThisType = ThisType<{
  readonly Characteristic: typeof import('homebridge').Characteristic;
  readonly tpLink: TPLink;
  readonly log: Logger;
  readonly mac: string;
  lastAlarmState?: boolean;
}>;

export interface HubContext {
  name: string;
  child: true;
  parent: string;
}

export default class HubAccessory extends TapoAccessory {
  private readonly Characteristic = this.platform.Characteristic;

  private readonly currentChar: CharInstance;
  private readonly targetChar: CharInstance;
  private alarmPollTimer?: NodeJS.Timeout;
  private alarmPollInFlight = false;
  public lastAlarmState?: boolean;

  public get UUID() {
    return this.accessory.UUID.toString();
  }

  public async getChildDevices() {
    const response = await this.tpLink.sendCommand('childDeviceList');
    return response.child_device_list;
  }

  public async getChildInfo(childId: string) {
    return this.tpLink.getChildInfo(childId);
  }

  public async getChildLogs(childId: string) {
    const response = await this.tpLink.sendHubCommand(
      'getTriggerLogs',
      childId,
      childId
    );
    return response?.responseData?.result;
  }

  constructor(
    platform: Platform,
    accessory: PlatformAccessory<Context>,
    log: Logger,
    deviceInfo: DeviceInfo
  ) {
    super(platform, accessory, log, deviceInfo);

    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(
        this.Characteristic.Manufacturer,
        'TP-Link Technologies'
      )
      .setCharacteristic(this.Characteristic.Model, this.model)
      .setCharacteristic(this.Characteristic.SerialNumber, this.mac);

    const service =
      this.accessory.getService(this.Characteristic.SecuritySystem) ||
      this.accessory.addService(this.Characteristic.SecuritySystem);

    this.currentChar = service
      .getCharacteristic(this.Characteristic.SecuritySystemCurrentState)
      .onGet(CurrentState.get.bind(this));

    this.targetChar = service
      .getCharacteristic(this.Characteristic.SecuritySystemTargetState)
      .setProps({
        // Keep the required HomeKit target characteristic, but expose only
        // DISARM so HomeKit cannot arm the Tapo system.
        validValues: [this.Characteristic.SecuritySystemTargetState.DISARM],
      })
      .onGet(TargetState.get.bind(this))
      .onSet(() => {
        // A DISARM write is harmless and intentionally does not control Tapo.
        this.targetChar.updateValue(
          this.Characteristic.SecuritySystemTargetState.DISARM
        );
      });

    this.targetChar.updateValue(
      this.Characteristic.SecuritySystemTargetState.DISARM
    );

    this.startAlarmStatePolling();
    this.platform.api.on('shutdown', () => this.cleanup());
  }

  private startAlarmStatePolling() {
    void this.pollAlarmState();
    this.alarmPollTimer = setInterval(() => {
      void this.pollAlarmState();
    }, 1000);
  }

  private async pollAlarmState() {
    if (this.alarmPollInFlight) {
      return;
    }

    this.alarmPollInFlight = true;
    try {
      const deviceInfo = await this.tpLink.getInfo();
      // An omitted alarm flag is unknown, not a confirmed alarm-clear event.
      const alarmActive = resolveAlarmState(
        deviceInfo.in_alarm,
        this.lastAlarmState
      );
      if (alarmActive === undefined) {
        this.log.debug('H100 alarm state is unavailable; keeping the last known state.');
        return;
      }

      if (this.lastAlarmState !== alarmActive) {
        this.lastAlarmState = alarmActive;
        this.currentChar.updateValue(
          alarmActive
            ? this.Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED
            : this.Characteristic.SecuritySystemCurrentState.DISARMED
        );
        this.log.info(
          'H100 alarm state:',
          alarmActive ? 'TRIGGERED' : 'cleared',
          '| source:',
          deviceInfo.in_alarm_source ?? 'unknown'
        );
      }
    } catch (error: any) {
      this.log.debug(
        'Unable to poll H100 alarm state:',
        error?.message ?? error
      );
    } finally {
      this.alarmPollInFlight = false;
    }
  }

  public cleanup() {
    if (this.alarmPollTimer) {
      clearInterval(this.alarmPollTimer);
      this.alarmPollTimer = undefined;
    }
  }
}
