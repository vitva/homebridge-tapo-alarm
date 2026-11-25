import {
  PlatformAccessory,
  Logger,
  Characteristic as CharInstance
} from 'homebridge';

import { ChildInfo } from '../../api/@types/ChildListInfo';
import HubAccessory, { HubContext } from '../Hub';
import TapoAccessory from '../../@types/TapoAccessory';
import Context from '../../@types/Context';
import Platform from '../../platform';

import StatusLowBattery from './characteristics/StatusLowBattery';

export type AccessoryThisType = ThisType<{
  readonly hub: HubAccessory;
  readonly getInfo: () => Promise<ChildInfo>;
}>;

export default class ButtonAccessory extends TapoAccessory {
  private interval?: NodeJS.Timeout;
  private lastEventUpdate = 0;
  private checking = false;
  private stopped = false;

  public get UUID() {
    return this.accessory.UUID.toString();
  }

  private getInfo() {
    return this.hub.getChildInfo(this.deviceInfo.device_id);
  }

  constructor(
    private readonly hub: HubAccessory,
    platform: Platform,
    accessory: PlatformAccessory<HubContext>,
    log: Logger,
    deviceInfo: ChildInfo
  ) {
    super(
      platform,
      accessory as unknown as PlatformAccessory<Context>,
      log,
      deviceInfo
    );

    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.Characteristic.Manufacturer,
        'TP-Link Technologies'
      )
      .setCharacteristic(this.platform.Characteristic.Model, this.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.mac);

    const service =
      this.accessory.getService(
        this.platform.Service.StatelessProgrammableSwitch
      ) ||
      this.accessory.addService(
        this.platform.Service.StatelessProgrammableSwitch
      );

    const characteristic = service
      .getCharacteristic(this.platform.Characteristic.ProgrammableSwitchEvent)
      .setProps({
        validValues: [
          this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
          this.platform.Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS
        ]
      });

    (
      service.getCharacteristic(
        this.platform.Characteristic.StatusLowBattery
      ) ||
      service.addCharacteristic(this.platform.Characteristic.StatusLowBattery)
    ).onGet(StatusLowBattery.get.bind(this));

    this.platform.api.on('shutdown', () => this.cleanup());
    void this.setup(characteristic);
  }

  private async setup(characteristic: CharInstance) {
    try {
      const init = await this.hub.getChildLogs(this.deviceInfo.device_id);
      this.lastEventUpdate = init?.logs?.[0]?.timestamp ?? 0;
    } catch (error) {
      this.log.warn('Unable to initialize S200 event cursor:', error);
    }

    // Shutdown may happen while the initial log request is still pending.
    // Do not start a new polling interval after cleanup has already run.
    if (this.stopped) {
      return;
    }

    // The upstream implementation immediately recursed after every successful
    // request. Use a bounded interval to avoid continuously polling the H100.
    this.interval = setInterval(() => {
      void this.checkStatus(characteristic);
    }, 1000);
  }

  private async checkStatus(characteristic: CharInstance) {
    if (this.checking) {
      return;
    }

    this.checking = true;
    try {
      const response = await this.hub.getChildLogs(this.deviceInfo.device_id);
      const lastEvent = response?.logs?.[0];

      if (
        lastEvent?.timestamp !== undefined &&
        this.lastEventUpdate < lastEvent.timestamp
      ) {
        this.lastEventUpdate = lastEvent.timestamp;
        switch (lastEvent.event ?? '') {
          case 'singleClick':
            characteristic.updateValue(
              this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
            );
            break;
          case 'doubleClick':
            characteristic.updateValue(
              this.platform.Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS
            );
            break;
        }
      }
    } catch (error) {
      this.log.warn('Failed to check S200 button events:', error);
    } finally {
      this.checking = false;
    }
  }

  public cleanup() {
    this.stopped = true;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }
}
