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
import { updateS200Cursor } from '../../utils/alarmState';

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
  private eventCursorInitialized = false;
  private rotationRightChar?: CharInstance;
  private rotationLeftChar?: CharInstance;

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

    if (this.model.toUpperCase() === 'S200D') {
      this.setupRotationServices(service);
    }

    (
      service.getCharacteristic(
        this.platform.Characteristic.StatusLowBattery
      ) ||
      service.addCharacteristic(this.platform.Characteristic.StatusLowBattery)
    ).onGet(StatusLowBattery.get.bind(this));

    this.platform.api.on('shutdown', () => this.cleanup());
    void this.setup(characteristic);
  }

  private setupRotationServices(clickService: any) {
    const labelService =
      this.accessory.getService(this.platform.Service.ServiceLabel) ||
      this.accessory.addService(this.platform.Service.ServiceLabel);

    labelService
      .getCharacteristic(
        this.platform.Characteristic.ServiceLabelNamespace
      )
      .updateValue(
        this.platform.Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS
      );

    clickService
      .getCharacteristic(this.platform.Characteristic.ServiceLabelIndex)
      .updateValue(1);
    clickService.addLinkedService(labelService);

    const createRotationService = (
      subtype: string,
      name: string,
      labelIndex: number
    ): CharInstance => {
      const service =
        this.accessory.getServiceById(
          this.platform.Service.StatelessProgrammableSwitch,
          subtype
        ) ||
        this.accessory.addService(
          this.platform.Service.StatelessProgrammableSwitch,
          name,
          subtype
        );

      service
        .getCharacteristic(
          this.platform.Characteristic.ProgrammableSwitchEvent
        )
        .setProps({
          validValues: [
            this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
          ]
        });

      service
        .getCharacteristic(this.platform.Characteristic.ServiceLabelIndex)
        .updateValue(labelIndex);
      service.addLinkedService(labelService);

      return service.getCharacteristic(
        this.platform.Characteristic.ProgrammableSwitchEvent
      );
    };

    this.rotationRightChar = createRotationService(
      's200d-rotation-right',
      'S200D Поворот по часовой стрелке',
      2
    );
    this.rotationLeftChar = createRotationService(
      's200d-rotation-left',
      'S200D Поворот против часовой стрелки',
      3
    );
  }

  private async setup(characteristic: CharInstance) {
    try {
      const init = await this.hub.getChildLogs(this.deviceInfo.device_id);
      if (Array.isArray(init?.logs)) {
        const cursor = updateS200Cursor(init.logs, false, 0);
        this.lastEventUpdate = cursor.lastTimestamp;
        this.eventCursorInitialized = cursor.initialized;
      }
    } catch (error) {
      this.log.warn('Unable to initialize S200 event cursor:', error);
    }

    // Shutdown may happen while the initial log request is still pending.
    // Do not start a new polling interval after cleanup has already run.
    if (this.stopped) {
      return;
    }

    this.interval = setInterval(() => {
      void this.checkStatus(characteristic);
    }, 1000);
  }

  private async checkStatus(characteristic: CharInstance) {
    if (this.stopped || this.checking) {
      return;
    }

    this.checking = true;
    try {
      const response = await this.hub.getChildLogs(this.deviceInfo.device_id);
      if (this.stopped) {
        return;
      }

      const cursor = updateS200Cursor(
        response?.logs,
        this.eventCursorInitialized,
        this.lastEventUpdate
      );
      this.eventCursorInitialized = cursor.initialized;
      this.lastEventUpdate = cursor.lastTimestamp;

      if (cursor.rotationDirection === 'right' && this.rotationRightChar) {
        this.rotationRightChar.sendEventNotification(
          this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
        );
        this.log.debug(
          'S200D rotated clockwise:',
          cursor.rotationDegrees ?? 'degrees unavailable'
        );
      } else if (
        cursor.rotationDirection === 'left' &&
        this.rotationLeftChar
      ) {
        this.rotationLeftChar.sendEventNotification(
          this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
        );
        this.log.debug(
          'S200D rotated counter-clockwise:',
          cursor.rotationDegrees ?? 'degrees unavailable'
        );
      } else {
        switch ((cursor.event ?? '').toLowerCase()) {
          case 'singleclick':
          case 'single_click':
            characteristic.sendEventNotification(
              this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
            );
            break;
          case 'doubleclick':
          case 'double_click':
            characteristic.sendEventNotification(
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
